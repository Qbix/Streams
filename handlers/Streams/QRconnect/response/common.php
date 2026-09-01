<?php

/**
 * Returns the interests you have in common with another user, and the live
 * event you're both checked in to, if any.
 *
 * @param {array} $_REQUEST
 * @param {string} $_REQUEST.userId The other person
 * @return {array}
 */
function Streams_QRconnect_response_common()
{
	$user = Users::loggedInUser(true);
	Q_Valid::requireFields(array('userId'), $_REQUEST, true);
	$userId = $_REQUEST['userId'];

	$event = Streams_QRconnect::coPresentEvent($user->id, $userId);

	return array(
		'userId' => $userId,
		'interests' => Streams_QRconnect::commonInterests($user->id, $userId),
		'event' => $event ? array(
			'publisherId' => $event->publisherId,
			'streamName' => $event->name,
			'title' => $event->title
		) : null
	);
}
