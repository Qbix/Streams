<?php

/**
 * @module Streams
 */

/**
 * Used by HTTP clients to fork an existing stream into a workspace.
 * @class HTTP Streams fork
 * @method post
 * @param {array} [$params] Parameters that can come from the request
 *   @param {string} $params.publisherId Required. The publisher of the source stream.
 *   @param {string} $params.streamName Required. The name of the source stream.
 *   @param {integer} $params.ordinal Required. Messages from this ordinal onward
 *     belong to the fork. Earlier messages are inherited transparently from the source.
 *   @param {string} $params.toPublisherId Required. The publisher of the forked stream.
 *     Typically of the form "$publisherId~$workspaceId".
 *   @param {string} [$params.toStreamName] Optional. Defaults to same as streamName.
 */
function Streams_fork_post($params = array())
{
	$user = Users::loggedInUser(true);
	$req  = array_merge($_REQUEST, $params);

	$publisherId   = Q::ifset($req, 'publisherId', null)
		?: Streams::requestedPublisherId(true);
	$streamName    = Q::ifset($req, 'streamName', null)
		?: Streams::requestedName(true);
	$toPublisherId = Q::ifset($req, 'toPublisherId', null);
	$toStreamName  = Q::ifset($req, 'toStreamName', null);

	if (empty($toPublisherId)) {
		throw new Q_Exception_RequiredField(
			array('field' => 'toPublisherId'),
			'toPublisherId'
		);
	}

	if (!isset($req['ordinal'])) {
		throw new Q_Exception_RequiredField(
			array('field' => 'ordinal'),
			'ordinal'
		);
	}
	$ordinal = (int)$req['ordinal'];

	// Validate that toPublisherId is a workspace publisher
	// Forking into a non-workspace publisher requires skipAccess,
	// which is not available to HTTP clients
	if (!Streams::isWorkspacePublisherId($toPublisherId)) {
		throw new Q_Exception_WrongValue(array(
			'field' => 'toPublisherId',
			'range' => 'a workspace publisher of the form "$publisherId~$workspaceId"'
		));
	}

	// Validate that the workspace name portion is registered
	$workspaceName = Streams_Workspace::nameFromPublisherId($toPublisherId);
	if (!Streams_Workspace::exists($workspaceName)) {
		throw new Q_Exception_MissingRow(array(
			'table' => 'Streams_Workspace',
			'criteria' => "name = '$workspaceName'"
		));
	}

	$fork = Streams::fork(
		$user->id,
		$publisherId,
		$streamName,
		$ordinal,
		$toPublisherId,
		$toStreamName
	);

	if ($fork === false) {
		// canceled by before hook
		Q_Response::setSlot('stream', null);
		return;
	}

	Streams::$cache['stream'] = $fork;
	Q_Response::setSlot('stream', $fork->exportArray());
}