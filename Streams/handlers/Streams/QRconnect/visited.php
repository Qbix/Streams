<?php

/**
 * Records a visit when someone follows a user's profile invite link — the kind
 * Streams::userInviteUrl generates for QR codes and NFC tags.
 *
 * Hooks Streams/invite/followed, fired from Streams_after_Q_objects once the
 * framework has already resolved and validated the invite. That's a far better
 * signal than reading the querystring: no signature to re-verify, and it fires
 * at the same moment, before the redirect to the profile.
 *
 * A logged-in visitor is JOINED to the publisher's visits stream, which gives
 * a deduplicated roster for Streams/participants and, via
 * Streams_Stream::join, a "Streams/joined" message the first time and
 * "Streams/visited" on each visit after. A logged-out visitor can't be a
 * participant, so that case posts "Streams/profile/visited" instead.
 *
 * Hook it up in config:
 *   "Q": { "handlersAfterEvent": {
 *       "Streams/invite/followed": ["Streams/QRconnect/visited"]
 *   }}
 *
 * @param {array} $params
 * @param {Streams_Invite} $params.invite
 * @param {Streams_Stream} $params.stream
 * @param {Users_User} $params.user Null if nobody is logged in
 * @param {mixed} $return
 */
function Streams_QRconnect_visited($params = array(), &$return = null)
{
	if (!Q_Config::get('Streams', 'QRconnect', 'visits', 'enabled', true)) {
		return;
	}

	$invite = Q::ifset($params, 'invite', null);
	$stream = Q::ifset($params, 'stream', null);
	if (!$invite or !$stream) {
		return;
	}

	// only profile invites are QRconnect codes; event invites and the rest
	// of the invites in the system are none of our business
	$profileStreamName = Q_Config::get(
		'Streams', 'QRconnect', 'profileStreamName', 'Streams/user/profile'
	);
	if ($stream->name !== $profileStreamName) {
		return;
	}

	// Streams_Invite::$followed can stay set for the rest of the session, so
	// without this we'd record a visit on every page load, not on arrival.
	if (!Streams_QRconnect_visited_arrivedNow()) {
		return;
	}

	$publisherId = $invite->publisherId;

	$user = Q::ifset($params, 'user', null);
	$visitorId = $user ? $user->id : '';

	if ($visitorId === $publisherId) {
		return; // looking at your own code
	}

	// throttle per session, so a refresh doesn't pile up Streams/visited
	$throttle = Q_Config::get('Streams', 'QRconnect', 'visits', 'throttle', 300);
	if ($throttle and isset($_SESSION)) {
		$key = 'Streams_QRconnect_visited';
		$recent = Q::ifset($_SESSION, $key, array());
		$last = Q::ifset($recent, $publisherId, 0);
		if (time() - $last < $throttle) {
			return;
		}
		$recent[$publisherId] = time();
		$_SESSION[$key] = $recent;
	}

	// see Streams_QRconnect::recordVisit for why joining beats posting
	Streams_QRconnect::recordVisit($publisherId, $visitorId);
}

/**
 * Whether the invite is being presented in THIS request, as opposed to being
 * remembered from earlier in the session.
 *
 * Checks for the invite token parameter and for the "u" field that
 * Streams::userInviteUrl appends. PHP rewrites dots in querystring names to
 * underscores, so both spellings of the token are checked.
 *
 * @return {boolean}
 */
function Streams_QRconnect_visited_arrivedNow()
{
	foreach (array('Q.Streams.token', 'Q_Streams_token', 'u') as $field) {
		if (!empty($_REQUEST[$field])) {
			return true;
		}
	}
	return false;
}