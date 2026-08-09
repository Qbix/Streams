<?php

/**
 * Records a connection when someone accepts an invite to a user's profile
 * stream — which is what a Streams/QRconnect code invites them to.
 *
 * Hooks Streams/invite/accept, which Streams_Invite::accept already fires
 * after everything has settled. Nothing needs patching to make this work,
 * and consent has demonstrably happened by then: the invite was either
 * auto-accepted or the person pressed a button.
 *
 * The visitor JOINS the publisher's visits stream, giving a deduplicated
 * roster for Streams/participants and, via Streams_Stream::join, a
 * "Streams/joined" message the tool listens for. Nothing here posts a
 * message type of its own.
 *
 * Hook it up in config:
 *   "Q": { "handlersAfterEvent": {
 *       "Streams/invite/accept": ["Streams/QRconnect/accepted"]
 *   }}
 *
 * @param {array} $params
 * @param {Streams_Invite} $params.invite
 * @param {Streams_Stream} $params.stream
 * @param {string} $params.userId Who accepted
 * @param {mixed} $return
 */
function Streams_QRconnect_accepted($params = array(), &$return = null)
{
	if (!Q_Config::get('Streams', 'QRconnect', 'visits', 'enabled', true)) {
		return;
	}

	$invite = Q::ifset($params, 'invite', null);
	$stream = Q::ifset($params, 'stream', null);
	$userId = Q::ifset($params, 'userId', null);

	if (!$invite or !$stream or !$userId) {
		return;
	}

	// only profile-code invites; every other invite in the system,
	// including personal invites to a profile, passes through
	if (!Streams_QRconnect::isCodeInvite($invite, $stream)) {
		return;
	}

	Streams_QRconnect::recordVisit($stream->publisherId, $userId);
}
