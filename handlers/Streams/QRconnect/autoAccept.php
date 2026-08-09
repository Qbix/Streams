<?php

/**
 * Auto-accepts a profile-code invite when both people are checked in to the
 * same event, happening right now.
 *
 * Hooks Streams/invite/autoAccept, fired from Streams_Invite::shouldAutoAccept.
 * That method is the one place both accept paths consult — the already-logged-in
 * path in Streams_after_Q_objects and the just-registered path in
 * Streams_after_Users_setLoggedInUser — so hooking it covers both. Its own
 * safety guards run first: a personal invite never qualifies, and neither does
 * one carrying dontAutoAccept.
 *
 * Co-presence means both hold the "attendee" role, which is set by the QR
 * check-in scanner or the attendance sheet, so it means they came through the
 * door rather than that they said yes last week.
 *
 * Hook it up in config:
 *   "Q": { "handlersAfterEvent": {
 *       "Streams/invite/autoAccept": ["Streams/QRconnect/autoAccept"]
 *   }}
 *
 * @param {array} $params
 * @param {Streams_Invite} $params.invite
 * @param {Streams_Stream} $params.stream
 * @param {Users_User} $params.user
 * @param {boolean} $result Set to true to accept without asking
 */
function Streams_QRconnect_autoAccept($params = array(), &$result = null)
{
	if ($result === true) {
		return; // something already decided
	}
	if (!Q_Config::get('Streams', 'QRconnect', 'coPresence', 'autoAccept', true)) {
		return;
	}

	$invite = Q::ifset($params, 'invite', null);
	$stream = Q::ifset($params, 'stream', null);
	$user = Q::ifset($params, 'user', null);

	if (!$invite or !$stream or !$user) {
		return;
	}
	if (!Streams_QRconnect::isCodeInvite($invite, $stream)) {
		return; // only profile codes
	}

	$event = Streams_QRconnect::coPresentEvent($user->id, $stream->publisherId);
	if (!$event) {
		return; // not in the same room -- let the dialog ask
	}

	$result = true;
}
