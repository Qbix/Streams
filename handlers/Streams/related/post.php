<?php

/**
 * @module Streams
 */

/**
 * Used to create a new relation between streams
 * @class HTTP Streams related
 * @method post
 * @param {array} [$_REQUEST] Parameters that can come from the request
 *   @param {string} $_REQUEST.toPublisherId The publisher of the 'to' stream
 *   @param {string} $_REQUEST.toStreamName The name of the 'to' stream
 *   @param {string} $_REQUEST.type The type of the relation to create
 *   @param {string} $_REQUEST.fromPublisherId The publisher of the 'from' stream
 *   @param {string} $_REQUEST.fromStreamName The name of the 'from' stream
 *   @param {boolean} [$_REQUEST.inheritAccess=false] Whether to inherit access from the 'to' stream
 *   @param {double} [$_REQUEST.weight] Optional weight for the relation
 */

function Streams_related_post($params) {
	$user = Users::loggedInUser(true);
	$asUserId = $user->id;
	$toPublisherId = $_REQUEST['toPublisherId'];
	$toStreamName = $_REQUEST['toStreamName'];
	$type = $_REQUEST['type'];
	$fromPublisherId = $_REQUEST['fromPublisherId'];
	$fromStreamName = $_REQUEST['fromStreamName'];

	$req = array_merge($_REQUEST, $params);
	$inheritAccess = filter_var(
		Q_Request::special("Streams.related.inheritAccess", false, $req),
		FILTER_VALIDATE_BOOLEAN
	);
	
	// TODO: When we start supporting multiple hosts, this will have to be rewritten
	// to make servers communicate with one another when establishing relations between streams
	$categories = Streams::fetch($asUserId, $toPublisherId, $toStreamName);
	if (empty($categories)) {
		throw new Q_Exception_MissingRow(
			array('table' => 'stream', 'criteria' => 'with those fields'), 
			array('publisherId', 'name')
		);
	}

	$streams = Streams::fetch($asUserId, $fromPublisherId, $fromStreamName);
	if (empty($streams)) {
		throw new Q_Exception_MissingRow(
			array('table' => 'stream', 'criteria' => 'with those fields'),
			array('fromPublisherId', 'from_name')
		);
	}

	$weight = time();
	foreach ($categories as $category) {
		foreach ($streams as $stream) {
			// check maxRelations attribute
			if (!Streams::checkAvailableRelations(null, $category->publisherId, $category->name, $type, array(
				"postMessage" => false,
				"throw" => !($_REQUEST["exception"] === false || $_REQUEST["exception"] === "false")
			))) {
				return;
			}

			if (isset($_REQUEST['weight'])) {
				if (!$category->testWriteLevel('relations')) {
					if ($_REQUEST["exception"] === false || $_REQUEST["exception"] === "false") {
						return;
					} else {
						throw new Users_Exception_NotAuthorized();
					}
				}
				$weight = $_REQUEST['weight'];
			}
		}
	}

	$result = Streams::relate(
		$asUserId, 
		$toPublisherId, 
		$toStreamName, 
		$type, 
		$fromPublisherId, 
		$fromStreamName,
		@compact('weight', 'inheritAccess')
	);
	Q_Response::setSlot('result', $result);
}