<?php

/**
 * Returns Streams_Invite::dialogData for a pending invite token, so an already
 * online invitee can open the consent dialog without following the invite link.
 *
 * @param {string} $_REQUEST.token The invite token from Streams/invited instructions
 * @return {array|null}
 */
function Streams_invite_response_dialog()
{
	$token = Q::ifset($_REQUEST, 'token', null);
	if (!$token) {
		throw new Q_Exception_RequiredField(array('field' => 'token'), 'token');
	}

	$user = Users::loggedInUser(true);
	$invite = Streams_Invite::fromToken($token, true);

	// Personal invite must be for this user; general invites are open to anyone
	if ($invite->userId && $invite->userId !== $user->id) {
		throw new Users_Exception_NotAuthorized();
	}

	if (Streams_Invite::stateFor($invite, $user->id) !== 'pending') {
		return null;
	}

	$stream = Streams_Stream::fetch(
		null, $invite->publisherId, $invite->streamName
	);
	if (!$stream) {
		throw new Q_Exception_MissingRow(array(
			'table' => 'stream',
			'criteria' => 'with that name'
		), 'streamName');
	}

	// Same session markers Streams_before_Q_objects sets when following a link,
	// so Accept/Decline can resolve this invite afterward.
	$_SESSION['Streams']['inviteFollowedToken'] = $invite->token;
	Streams_Invite::$followed = $invite;

	$dialogData = Streams_Invite::dialogData($invite, $stream, $user);
	if ($dialogData) {
		Q_Response::addTemplate(Q::ifset(
			$dialogData, 'templateName', 'Streams/templates/invited/complete'
		));
	}
	return $dialogData;
}
