<?php
/**
 * Plugin Name: Claw Agent Collab
 * Description: Realtime AI agent collaboration in the WordPress block editor. Adds a chat sidebar for communicating with the Claw Agent and receiving edit suggestions.
 * Version: 0.1.0
 * Author: Automattic
 * License: GPL-2.0-or-later
 * Text Domain: claw-agent-collab
 */

defined( 'ABSPATH' ) || exit;

define( 'CLAW_AGENT_COLLAB_VERSION', '0.1.0' );
define( 'CLAW_AGENT_COLLAB_PATH', plugin_dir_path( __FILE__ ) );
define( 'CLAW_AGENT_COLLAB_URL', plugin_dir_url( __FILE__ ) );

/**
 * Plugin activation: create the agent user and generate an application password.
 */
function claw_agent_collab_activate() {
	$username = 'claw-agent';

	// Bail if user already exists.
	$existing_user = get_user_by( 'login', $username );
	if ( $existing_user ) {
		return;
	}

	// Create the agent user with the Editor role.
	$user_id = wp_insert_user(
		array(
			'user_login'   => $username,
			'user_pass'    => wp_generate_password( 32, true, true ),
			'display_name' => 'Claw Agent',
			'role'         => 'editor',
			'user_email'   => 'claw-agent@localhost.invalid',
		)
	);

	if ( is_wp_error( $user_id ) ) {
		return;
	}

	// Generate an application password for the agent user.
	$app_password = WP_Application_Passwords::create_new_application_password(
		$user_id,
		array(
			'name' => 'Claw Agent Collab',
		)
	);

	if ( is_wp_error( $app_password ) ) {
		return;
	}

	// Store the unhashed password so the OpenClaw channel can authenticate.
	// $app_password is [ 'password' => string, ... ].
	update_option( 'claw_agent_app_password', $app_password[0], false );
	update_option( 'claw_agent_user_id', $user_id, false );
}
register_activation_hook( __FILE__, 'claw_agent_collab_activate' );

/**
 * Plugin deactivation: remove the agent user and stored options.
 */
function claw_agent_collab_deactivate() {
	$user_id = get_option( 'claw_agent_user_id' );
	if ( $user_id ) {
		require_once ABSPATH . 'wp-admin/includes/user.php';
		wp_delete_user( (int) $user_id );
	}

	delete_option( 'claw_agent_app_password' );
	delete_option( 'claw_agent_user_id' );
}
register_deactivation_hook( __FILE__, 'claw_agent_collab_deactivate' );

/**
 * Register post meta fields that sync via Yjs realtime collaboration.
 *
 * Setting show_in_rest to true means the meta values are included in the
 * block editor's data stores and automatically synced between collaborators
 * via WordPress 7.0's Yjs CRDT layer.
 */
function claw_agent_collab_register_meta() {
	$post_types = get_post_types( array( 'show_in_rest' => true ), 'names' );

	foreach ( $post_types as $post_type ) {
		register_post_meta(
			$post_type,
			'_claw_chat_messages',
			array(
				'type'              => 'string',
				'single'            => true,
				'show_in_rest'      => true,
				'default'           => '[]',
				'sanitize_callback' => 'claw_agent_collab_sanitize_json',
				'auth_callback'     => function () {
					return current_user_can( 'edit_posts' );
				},
			)
		);

		register_post_meta(
			$post_type,
			'_claw_suggestions',
			array(
				'type'              => 'string',
				'single'            => true,
				'show_in_rest'      => true,
				'default'           => '[]',
				'sanitize_callback' => 'claw_agent_collab_sanitize_json',
				'auth_callback'     => function () {
					return current_user_can( 'edit_posts' );
				},
			)
		);
	}
}
add_action( 'init', 'claw_agent_collab_register_meta' );

/**
 * Sanitize callback for JSON meta values.
 *
 * @param string $value Raw value.
 * @return string Sanitised JSON string.
 */
function claw_agent_collab_sanitize_json( $value ) {
	$decoded = json_decode( $value, true );
	if ( json_last_error() !== JSON_ERROR_NONE || ! is_array( $decoded ) ) {
		return '[]';
	}
	return wp_json_encode( $decoded );
}

/**
 * Enqueue the sidebar script and styles in the block editor.
 */
function claw_agent_collab_enqueue_editor_assets() {
	$asset_file = CLAW_AGENT_COLLAB_PATH . 'build/index.asset.php';
	if ( ! file_exists( $asset_file ) ) {
		return;
	}

	$asset = require $asset_file;

	wp_enqueue_script(
		'claw-agent-collab-sidebar',
		CLAW_AGENT_COLLAB_URL . 'build/index.js',
		$asset['dependencies'],
		$asset['version'],
		true
	);

	wp_enqueue_style(
		'claw-agent-collab-sidebar',
		CLAW_AGENT_COLLAB_URL . 'build/index.css',
		array( 'wp-components' ),
		$asset['version']
	);

	// Pass the agent user ID to the client so it can distinguish agent messages.
	wp_localize_script(
		'claw-agent-collab-sidebar',
		'clawAgentCollab',
		array(
			'agentUserId'   => (int) get_option( 'claw_agent_user_id', 0 ),
			'currentUserId' => get_current_user_id(),
		)
	);
}
add_action( 'enqueue_block_editor_assets', 'claw_agent_collab_enqueue_editor_assets' );

/**
 * Register REST endpoint for channel discovery.
 */
function claw_agent_collab_register_rest_routes() {
	register_rest_route(
		'claw-agent/v1',
		'/config',
		array(
			'methods'             => 'GET',
			'callback'            => 'claw_agent_collab_rest_config',
			'permission_callback' => '__return_true',
		)
	);
}
add_action( 'rest_api_init', 'claw_agent_collab_register_rest_routes' );

/**
 * REST callback: return agent config for channel discovery.
 *
 * @return WP_REST_Response
 */
function claw_agent_collab_rest_config() {
	return new WP_REST_Response(
		array(
			'agent_user_id' => (int) get_option( 'claw_agent_user_id', 0 ),
			'site_url'      => get_site_url(),
			'plugin_version' => CLAW_AGENT_COLLAB_VERSION,
		),
		200
	);
}
