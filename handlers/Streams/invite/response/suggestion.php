<?php

function Streams_invite_response_suggestion()
{
	$publisherId = Streams::requestedPublisherId(true);
	$streamName = Streams::requestedName(true);
	$stream = Streams_Stream::fetch(null, $publisherId, $streamName, true);
	
	if (!empty($_REQUEST['token'])) {
		$roles = Q_Config::get('Streams', 'invites', 'canSetInviteTokens', array());
		if (!Users::roles(Users::communityId(), $roles)) {
			throw new Users_Exception_NotAuthorized();
		}
		if ($token = $_REQUEST['token']) {
			if ($invite = Streams_Invite::fromToken($token)) {
				throw new Q_Exception_AlreadyExists(array('source' => 'invite with this token'));
			}
		}
	} else {
		$token = Streams_Invite::generateToken();
	}
	
	$suggestion = @compact('token');
	$suggestion = Q_Utils::sign($suggestion);
	
	$data = array(
		'url' => Streams::inviteUrl($token),
		'invite' => @compact('token')
	);
	
	Q_Response::setSlot('stream', $stream->exportArray());
	Q_Response::setSlot('data', $data);

	$params = array_merge($data, compact('stream', 'suggestion'));
	/**
	 * This event can be used by plugins to set more slots.
	 * In particular, the "hide" slot can be filled with an array
	 * naming what invite options to hide,
	 * e.g. "contacts", "qr", "share", "social", "roles"
	 * @event {after} Streams/invite/response/suggestion
	 * @param {string} url
	 * @param {string} suggestion
	 * @param {array} invite
	 * @param {Streams_Stream} stream
	 * @return {string}
	 *  Optional. If set, override method return
	 */
	Q::event('Streams/invite/response/suggestion', $params, 'after');

	if (Q_Response::getSlot('hide') === null) {
		Q_Response::setSlot('hide', array());
	}

	return $suggestion;
}