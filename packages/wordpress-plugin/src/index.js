/**
 * Claw Agent Collab — Gutenberg sidebar plugin.
 *
 * Renders a chat interface and edit-suggestion cards inside the block editor
 * sidebar. Messages and suggestions are stored as JSON in post meta that syncs
 * automatically between collaborators via WordPress 7.0's Yjs layer.
 */

import { registerPlugin } from '@wordpress/plugins';
import { PluginSidebar, PluginSidebarMoreMenuItem } from '@wordpress/editor';
import { useSelect, useDispatch } from '@wordpress/data';
import { useState, useRef, useEffect, useCallback } from '@wordpress/element';
import {
	Button,
	TextControl,
	Icon,
	Notice,
} from '@wordpress/components';
import { __ } from '@wordpress/i18n';
import { comment as commentIcon } from '@wordpress/icons';

import './index.css';

/* global clawAgentCollab */

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Generate a simple unique id (good enough for chat message keys).
 */
function uid() {
	return Date.now().toString( 36 ) + Math.random().toString( 36 ).slice( 2, 8 );
}

/**
 * Format an ISO timestamp into a short human-readable string.
 *
 * @param {string} iso ISO date string.
 * @return {string} Formatted time.
 */
function formatTime( iso ) {
	const d = new Date( iso );
	return d.toLocaleTimeString( [], { hour: '2-digit', minute: '2-digit' } );
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

/**
 * Single chat message bubble.
 */
function ChatMessage( { message, isAgent } ) {
	const authorLabel = isAgent ? __( 'Claw Agent', 'claw-agent-collab' ) : __( 'You', 'claw-agent-collab' );
	const bubbleClass = isAgent ? 'claw-chat__bubble claw-chat__bubble--agent' : 'claw-chat__bubble claw-chat__bubble--user';

	return (
		<div className={ `claw-chat__message ${ isAgent ? 'claw-chat__message--agent' : 'claw-chat__message--user' }` }>
			<div className={ bubbleClass }>
				<span className="claw-chat__author">{ authorLabel }</span>
				<span className="claw-chat__content">{ message.content }</span>
				<span className="claw-chat__time">{ formatTime( message.timestamp ) }</span>
			</div>
		</div>
	);
}

/**
 * A single edit-suggestion card with accept / reject buttons.
 */
function SuggestionCard( { suggestion, onAccept, onReject } ) {
	return (
		<div className="claw-suggestion">
			<div className="claw-suggestion__header">
				<Icon icon={ commentIcon } size={ 16 } />
				<span className="claw-suggestion__label">{ __( 'Edit suggestion', 'claw-agent-collab' ) }</span>
			</div>
			<p className="claw-suggestion__content">{ suggestion.content }</p>
			<div className="claw-suggestion__actions">
				<Button variant="primary" size="small" onClick={ () => onAccept( suggestion.id ) }>
					{ __( 'Accept', 'claw-agent-collab' ) }
				</Button>
				<Button variant="secondary" isDestructive size="small" onClick={ () => onReject( suggestion.id ) }>
					{ __( 'Reject', 'claw-agent-collab' ) }
				</Button>
			</div>
		</div>
	);
}

// ---------------------------------------------------------------------------
// Main sidebar component
// ---------------------------------------------------------------------------

function ClawSidebar() {
	const [ draft, setDraft ] = useState( '' );
	const messagesEndRef = useRef( null );

	const { editPost } = useDispatch( 'core/editor' );

	const { rawMessages, rawSuggestions, agentUserId, currentUserId } = useSelect(
		( select ) => {
			const meta = select( 'core/editor' ).getEditedPostAttribute( 'meta' ) || {};
			return {
				rawMessages: meta._claw_chat_messages || '[]',
				rawSuggestions: meta._claw_suggestions || '[]',
				agentUserId: clawAgentCollab?.agentUserId ?? 0,
				currentUserId: clawAgentCollab?.currentUserId ?? 0,
			};
		},
		[]
	);

	let messages = [];
	let suggestions = [];

	try {
		messages = JSON.parse( rawMessages );
	} catch {
		messages = [];
	}

	try {
		suggestions = JSON.parse( rawSuggestions );
	} catch {
		suggestions = [];
	}

	// Auto-scroll to newest message.
	useEffect( () => {
		messagesEndRef.current?.scrollIntoView( { behavior: 'smooth' } );
	}, [ rawMessages ] );

	/**
	 * Append a new message authored by the current user.
	 */
	const sendMessage = useCallback( () => {
		const text = draft.trim();
		if ( ! text ) {
			return;
		}

		const newMessage = {
			id: uid(),
			author: currentUserId,
			content: text,
			timestamp: new Date().toISOString(),
			type: 'message',
		};

		const updated = [ ...messages, newMessage ];
		editPost( { meta: { _claw_chat_messages: JSON.stringify( updated ) } } );
		setDraft( '' );
	}, [ draft, messages, currentUserId, editPost ] );

	/**
	 * Handle Enter key in the input field.
	 */
	const handleKeyDown = useCallback(
		( event ) => {
			if ( event.key === 'Enter' && ! event.shiftKey ) {
				event.preventDefault();
				sendMessage();
			}
		},
		[ sendMessage ]
	);

	/**
	 * Accept a suggestion — remove it from the list.
	 * (The actual content mutation would be handled by the agent channel.)
	 */
	const acceptSuggestion = useCallback(
		( id ) => {
			const updated = suggestions.filter( ( s ) => s.id !== id );
			editPost( { meta: { _claw_suggestions: JSON.stringify( updated ) } } );
		},
		[ suggestions, editPost ]
	);

	/**
	 * Reject (dismiss) a suggestion.
	 */
	const rejectSuggestion = useCallback(
		( id ) => {
			const updated = suggestions.filter( ( s ) => s.id !== id );
			editPost( { meta: { _claw_suggestions: JSON.stringify( updated ) } } );
		},
		[ suggestions, editPost ]
	);

	return (
		<div className="claw-sidebar">
			{ /* ---------- Suggestions ---------- */ }
			{ suggestions.length > 0 && (
				<div className="claw-sidebar__suggestions">
					<h3 className="claw-sidebar__section-title">{ __( 'Suggestions', 'claw-agent-collab' ) }</h3>
					{ suggestions.map( ( s ) => (
						<SuggestionCard
							key={ s.id }
							suggestion={ s }
							onAccept={ acceptSuggestion }
							onReject={ rejectSuggestion }
						/>
					) ) }
				</div>
			) }

			{ /* ---------- Messages ---------- */ }
			<div className="claw-chat__messages">
				{ messages.length === 0 && (
					<Notice status="info" isDismissible={ false } className="claw-chat__empty">
						{ __( 'No messages yet. Start a conversation with the Claw Agent!', 'claw-agent-collab' ) }
					</Notice>
				) }
				{ messages.map( ( m ) => (
					<ChatMessage
						key={ m.id }
						message={ m }
						isAgent={ m.author === agentUserId }
					/>
				) ) }
				<div ref={ messagesEndRef } />
			</div>

			{ /* ---------- Input ---------- */ }
			<div className="claw-chat__input-area">
				<TextControl
					className="claw-chat__input"
					placeholder={ __( 'Type a message\u2026', 'claw-agent-collab' ) }
					value={ draft }
					onChange={ setDraft }
					onKeyDown={ handleKeyDown }
					__nextHasNoMarginBottom
				/>
				<Button
					variant="primary"
					className="claw-chat__send"
					onClick={ sendMessage }
					disabled={ ! draft.trim() }
				>
					{ __( 'Send', 'claw-agent-collab' ) }
				</Button>
			</div>
		</div>
	);
}

// ---------------------------------------------------------------------------
// Register the plugin sidebar
// ---------------------------------------------------------------------------

registerPlugin( 'claw-agent-collab', {
	render: () => (
		<>
			<PluginSidebarMoreMenuItem target="claw-agent-collab-sidebar">
				{ __( 'Claw Agent', 'claw-agent-collab' ) }
			</PluginSidebarMoreMenuItem>
			<PluginSidebar
				name="claw-agent-collab-sidebar"
				title={ __( 'Claw Agent', 'claw-agent-collab' ) }
				icon={ commentIcon }
			>
				<ClawSidebar />
			</PluginSidebar>
		</>
	),
} );
