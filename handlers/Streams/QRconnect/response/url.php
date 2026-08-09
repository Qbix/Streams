<?php

/**
 * Returns the signed invite url to encode in a Streams/QRconnect QR code,
 * together with when it expires so the tool can refresh itself before then.
 *
 * You can only ask for your own url — the signature is what proves the code
 * came from you, so generating someone else's would defeat the point.
 *
 * @param {array} $_REQUEST
 * @param {string} [$_REQUEST.publisherId] Defaults to the logged-in user
 * @param {string} [$_REQUEST.appUrl] Where scanning should bring people
 * @return {array}
 */
function Streams_QRconnect_response_url()
{
	$user = Users::loggedInUser(true);
	$publisherId = Q::ifset($_REQUEST, 'publisherId', $user->id);

	if ($publisherId !== $user->id) {
		throw new Users_Exception_NotAuthorized();
	}

	$appUrl = Q::ifset($_REQUEST, 'appUrl', null);
	$url = Streams::userInviteUrl($user->id, $appUrl);

	// the "e" field userInviteUrl appends is the signature's expiry
	$expires = 0;
	$parts = parse_url($url);
	if (!empty($parts['query'])) {
		$query = array();
		parse_str($parts['query'], $query);
		$expires = (int)Q::ifset($query, 'e', 0);
	}

	return array(
		'url' => $url,
		'expires' => $expires,
		'publisherId' => $user->id
	);
}
