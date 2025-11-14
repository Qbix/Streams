<?php

function Streams_access_response_content($options)
{
	$ajax = true;
	$user = Users::loggedInUser(true);
	$streamName = Streams::requestedName(true);
	$publisherId = Streams::requestedPublisherId();
	if (empty($publisherId)) {
		$publisherId = $user->id;
	}
	$stream = new Streams_Stream();
	$stream->publisherId = $publisherId;
	$stream->name = $streamName;
	if (!$stream->retrieve()) {
		// try to create stream if it possibleUserStreams
		Q::event('Streams/stream/post', array(
			"publisherId" => $publisherId,
			"name" => $streamName,
			"dontSubscribe" => true
		));

		if (!$stream->retrieve()) {
			throw new Q_Exception_MissingRow(array(
				'table' => 'stream',
				'criteria' => 'with that name'
			), 'name');
		}
	}
	
	$options = Streams_Stream::getConfigField(
		$streamType, array('access'), array()
	);
	foreach (array('tabs', 'levels', 'ranges') as $k) {
		if (isset($options[$k])) {
			$$k = $options[$k];
		}
	}
	
	Q_Response::setSlot('title', "Access to: " . $stream->title);
	return Q::tool('Streams/access', @compact(
		'publisherId',
		'streamName',
		'ajax',
		'controls',
		'tabs',
		'levels',
		'ranges'
	), $controls ? array('tag' => null) : array());
}