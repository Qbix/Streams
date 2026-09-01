<?php

/**
 * Lets someone select participant roles to offer when inviting to a stream.
 *
 * Deliberately NOT the same tool as the community-role picker. That one reads
 * users_label rows, knows about per-community grantability and icon uploads.
 * This one reads a static vocabulary from config, filtered by
 * Streams_Participant::can(), and renders emoji instead of icons. The two share
 * the selection UX via the stylesheet, not the logic -- folding them together
 * would mean a mode flag threaded through everything.
 *
 * @class Streams participantRoles
 * @constructor
 * @param {array} $options
 * @param {string} $options.publisherId
 * @param {string} $options.streamName
 * @param {array} [$options.selected=array()] Roles selected to begin with
 * @param {boolean} [$options.readOnly=false] Show without allowing changes
 */
function Streams_participantRoles_tool($options)
{
	$publisherId = Q::ifset($options, 'publisherId', null);
	$streamName = Q::ifset($options, 'streamName', null);
	if (!$publisherId or !$streamName) {
		throw new Q_Exception_RequiredField(array('field' => 'publisherId and streamName'));
	}
	$stream = Streams_Stream::fetch(null, $publisherId, $streamName);
	$streamType = $stream ? $stream->type : '';

	$can = Streams_Participant::can($publisherId, $streamName);
	$options['isAdmin'] = !empty($can['isAdmin']);
	$available = array();
	foreach ($can['grant'] as $role) {
		$available[] = Streams_Participant::roleDisplay($streamType, $role);
	}

	// If there is nothing to offer, say so in the options rather than making
	// the client discover it after rendering -- a caller checking
	// $options['available'] server-side can skip emitting the button at all.
	$options['available'] = $available;
	$options['streamType'] = $streamType;
	$options['displayType'] = Streams_Stream::displayType($streamType);
	$options['selected'] = array_values((array)Q::ifset($options, 'selected', array()));

	Q_Response::addStylesheet('{{Streams}}/css/tools/participantRoles.css', 'Streams');
	Q_Response::addScript('{{Streams}}/js/tools/participantRoles.js', 'Streams');
	Q_Response::setToolOptions($options);
	return '';
}
