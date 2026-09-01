<?php

/**
 * Renders a QR code inline, encoding the user's signed invite url.
 * Scanning it brings the other person to this user's profile; when they
 * accept the invite, this tool opens their profile in turn.
 *
 * The url is generated here so the QR paints on first render instead of
 * waiting for a round trip. If the tool is set up client-side instead, it
 * fetches the url itself from the Streams/QRconnect "url" slot.
 *
 * @class Streams QRconnect
 * @constructor
 * @param {array} [$options]
 * @param {string} [$options.publisherId] Defaults to the logged-in user
 * @param {string} [$options.appUrl] Where scanning should bring people
 * @param {integer} [$options.size=250] Width and height of the QR code
 * @param {boolean} [$options.listen=true] Whether to watch for scanners
 * @param {boolean} [$options.invokeOnScanned=true] Open the scanner's profile
 * @param {string} [$options.profileUrl] Pattern for the profile url
 */
function Streams_QRconnect_tool($options)
{
	$user = Users::loggedInUser(false);

	if ($user) {
		$publisherId = Q::ifset($options, 'publisherId', $user->id);
		// only ever preload your own — see the response handler
		if ($publisherId === $user->id and !isset($options['url'])) {
			$appUrl = Q::ifset($options, 'appUrl', null);
			$url = Streams::userInviteUrl($user->id, $appUrl);

			$expires = 0;
			$parts = parse_url($url);
			if (!empty($parts['query'])) {
				$query = array();
				parse_str($parts['query'], $query);
				$expires = (int)Q::ifset($query, 'e', 0);
			}

			$options['publisherId'] = $user->id;
			$options['url'] = $url;
			$options['expires'] = $expires;
		}
	}

	Q_Response::setToolOptions($options);

	return '<div class="Streams_QRconnect_placeholder Q_placeholder_shimmer"></div>';
}
