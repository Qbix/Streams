<?php

/**
 * Control panel: everyone the logged-in user invited, and what became of it.
 * Route: Streams/referrals
 */
function Streams_referrals_response_content()
{
	$user = Users::loggedInUser();
	if (!$user) {
		Q_Response::redirect(Q_Request::baseUrl(true));
		return '';
	}

	$communityId = Q::ifset($_REQUEST, 'communityId', null);
	$rows = Streams_Invite::referrals($user->id, @compact('communityId'));
	$summary = Streams_Invite::referralSummary($rows);

	Q_Response::addStylesheet('{{Streams}}/css/referrals.css', 'Streams');
	Q_Response::setSlot('title', 'Your Referrals');

	return Q::view('Streams/content/referrals.php', @compact(
		'rows', 'summary', 'communityId', 'user'
	));
}
