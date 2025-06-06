<?php

function Streams_unsubscribe_post()
{
	$user = Users::loggedInUser(true);
	$publisherId = Streams::requestedPublisherId();
	$streamName = Streams::requestedName(true);
	$stream = Streams_Stream::fetch($user->id, $publisherId, $streamName, true);
	if ($participant = $stream->unsubscribe()) {
		Q_Response::setSlot('participant', $participant->exportArray());
	} else {
		Q_Response::setSlot('participant', null);
	}
}