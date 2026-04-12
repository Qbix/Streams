<?php

/**
 * @module Streams
 */

/**
 * Used to remove a relation between streams
 * @class HTTP Streams related
 * @method delete
 * @param {array} [$_REQUEST] Parameters that can come from the request
 *   @param {string} $_REQUEST.toPublisherId The publisher of the 'to' stream
 *   @param {string} $_REQUEST.toStreamName The name of the 'to' stream
 *   @param {string} $_REQUEST.type The type of the relation to remove
 *   @param {string} $_REQUEST.fromPublisherId The publisher of the 'from' stream
 *   @param {string} $_REQUEST.fromStreamName The name of the 'from' stream
 */
function Streams_related_delete($params) {
	$user = Users::loggedInUser(true);
	$asUserId = $user->id;
	$toPublisherId = $_REQUEST['toPublisherId'];
	$toStreamName = $_REQUEST['toStreamName'];
	$type = $_REQUEST['type'];
	$fromPublisherId = $_REQUEST['fromPublisherId'];
	$fromStreamName = $_REQUEST['fromStreamName'];
	
	// TODO: When we start supporting multiple hosts, this will have to be rewritten
	// to make servers communicate with one another when establishing relations between streams
	
	if (!($stream = Streams::fetch($asUserId, $toPublisherId, $toStreamName))) {
		Q_Response::setSlot('result', false);
	}
	if (!($stream = Streams::fetch($asUserId, $fromPublisherId, $fromStreamName))) {
		Q_Response::setSlot('result', false);
	}

	Streams::unrelate($asUserId, $toPublisherId, $toStreamName, $type, $fromPublisherId, $fromStreamName);
	Q_Response::setSlot('result', true);
}