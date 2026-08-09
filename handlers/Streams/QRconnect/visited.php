<?php

/**
 * Records a visit when someone opens a signed invite url — the kind
 * Streams::userInviteUrl generates for QR codes and NFC tags.
 *
 * Fires on the invite url request itself, before the redirect to the profile,
 * so it catches the scan rather than any later profile view. Runs for
 * logged-out visitors too; they just post with an empty byUserId.
 *
 * A logged-in visitor is JOINED to the publisher's visits stream, which gives
 * a deduplicated roster for the Streams/participants tool and, via
 * Streams_Stream::join, a "Streams/joined" message the first time and
 * "Streams/visited" on each visit after — so no message type of our own is
 * needed for the history. A logged-out visitor can't be a participant, so
 * that case posts "Streams/profile/visited" instead.
 * @param {array} $params
 * @param {mixed} $return
 */
function Streams_QRConnect_visited($params = array(), &$return = null)
{
	if (!Q_Config::get('Streams', 'QRConnect', 'visits', 'enabled', true)) {
		return;
	}

	$publisherId = Q_Request::special('Streams.invitingUserId');
	if (empty($publisherId)) {
		return; // not an invite url
	}

	$sig = Q::ifset($_GET, 's', null);
	$expires = Q::ifset($_GET, 'e', null);

	// verify the signature the same way Calendars/checkin does, so a
	// hand-typed ?u=someone can't fake a visit to their profile
	$fields = array('u' => $publisherId);
	if (!empty($expires)) {
		$fields['e'] = $expires;
	}
	$len = Q_Config::get('Streams', 'invites', 'signature', 'length', 10);
	$expected = substr(Q_Utils::signature($fields), 0, $len);
	if (empty($sig) or $sig !== $expected) {
		return;
	}
	if (!empty($expires) and time() > $expires) {
		return;
	}

	$visitor = Users::loggedInUser(false);
	$visitorId = $visitor ? $visitor->id : '';

	if ($visitorId === $publisherId) {
		return; // looking at your own code
	}

	// throttle per session, so a refresh or a crawler retry doesn't
	// pile up messages on someone's stream
	$throttle = Q_Config::get('Streams', 'QRConnect', 'visits', 'throttle', 300);
	if ($throttle and isset($_SESSION)) {
		$key = 'Streams_QRConnect_visited';
		$recent = Q::ifset($_SESSION, $key, array());
		$last = Q::ifset($recent, $publisherId, 0);
		if (time() - $last < $throttle) {
			return;
		}
		$recent[$publisherId] = time();
		$_SESSION[$key] = $recent;
	}

	// join the visitor to the publisher's visits stream. See
	// Streams_QRConnect::recordVisit for why joining beats posting.
	Streams_QRConnect::recordVisit($publisherId, $visitorId);
}
