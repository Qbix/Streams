<?php

/**
 * @module Streams
 */

/**
 * Used by HTTP clients to create a new workspace.
 * @class HTTP Streams workspace
 * @method post
 * @param {array} [$params] Parameters that can come from the request
 *   @param {string} $params.name Required. The workspace name (max 15 chars).
 *   @param {string} [$params.parentName] Optional. Name of the parent workspace.
 */
function Streams_workspace_post($params = array())
{
	$user = Users::loggedInUser(true);
	$req  = array_merge($_REQUEST, $params);

	$name       = Q::ifset($req, 'name', null);
	$parentName = Q::ifset($req, 'parentName', null);

	if (empty($name)) {
		throw new Q_Exception_RequiredField(
			array('field' => 'name'),
			'name'
		);
	}

	if (strlen($name) > 15) {
		throw new Q_Exception_WrongValue(array(
			'field' => 'name',
			'range' => 'a string of 15 characters or fewer'
		));
	}

	// Validate parentName exists if provided
	if ($parentName && !Streams_Workspace::exists($parentName)) {
		throw new Q_Exception_MissingRow(array(
			'table'    => 'Streams_Workspace',
			'criteria' => "name = '$parentName'"
		));
	}

	$workspace = Streams_Workspace::ensure($name, $parentName);

	Q_Response::setSlot('workspace', array(
		'name'       => $workspace->name,
		'parentName' => $workspace->parentName
	));
}