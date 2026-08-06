<?php

/**
 * Which participant roles the logged-in user may grant on a stream.
 *
 * Exists so a composer can decide whether to show an "add roles" button at all,
 * without rendering the picker first. Returns an empty "available" array both
 * when the stream type declares no vocabulary and when the viewer is entitled
 * to grant none of it -- the caller doesn't have to tell those apart to know
 * there is nothing to offer.
 *
 * @return {array} Has "available" ([{role,title,emoji}]) and "isAdmin"
 */
function Streams_participantRoles_response_data($params)
{
	// take the fields from $params when invoked directly (tests, other
	// handlers), falling back to the request when dispatched as an action
	$req = array_merge($_REQUEST, is_array($params) ? $params : array());
	$publisherId = Q::ifset($req, 'publisherId', null);
	$streamName = Q::ifset($req, 'streamName', null);
	if (!$publisherId or !$streamName) {
		throw new Q_Exception_RequiredField(array(
			'field' => 'publisherId and streamName'
		));
	}

	$user = Users::loggedInUser();
	if (!$user) {
		return array('available' => array(), 'isAdmin' => false);
	}

	// type resolves the vocabulary, so fetch without access filtering; the
	// grantability check below is what actually enforces access
	$stream = Streams_Stream::fetch(null, $publisherId, $streamName);
	if (!$stream) {
		return array('available' => array(), 'isAdmin' => false);
	}

	$can = Streams_Participant::can($publisherId, $streamName, $user->id);
	$available = array();
	foreach ($can['grant'] as $role) {
		$available[] = Streams_Participant::roleDisplay($stream->type, $role);
	}
	return array(
		'available' => $available,
		'isAdmin' => !empty($can['isAdmin'])
	);
}
