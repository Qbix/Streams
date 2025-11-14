<?php

/**
 * @module Streams-tools
 */

/**
 * Access tool
 * @class Streams access
 * @constructor
 * @param {array} $options Options for the tool
 * @param {string} [$options.publisherId] the id of the user who is publishing the stream
 * @param {string} [$options.streamName] the name of the stream for which to edit access levels
 * @param {array} [$options.tabs] Defaults to ("read", "write", "admin"), but you can pass a subset.
 * @param {array} [$options.ranges] associative array with keys "read", "write", "admin" and values as associative arrays of ($min, $max) for the displayed levels.
 * @param {boolean} [$options.controls] optionally set this to true to render only the controls
 */
function Streams_access_tool($options)
{
	$defaults = Streams_Stream::getConfigField(
		$streamType, array('access'), array()
	);
	$options = array_merge($defaults, $options);

	extract($options);
	$tabNames = isset($tabs) ? $tabs : array('read', 'write', 'admin');

	$text = Q_Text::get('Streams/access');
	$tabs = array(
		'read'  => $text['tabs']['read'], 
		'write' => $text['tabs']['write'], 
		'admin' => $text['tabs']['admin']
	);
	$tabs = Q::take($tabs, $tabNames);

	$user = Users::loggedInUser(true);
	/**
	 * @var string $streamName
	 */
	if (empty($streamName)) {
		$streamName = Streams::requestedName(true);
	}

	if (empty($publisherId)) {
		$publisherId = Streams::requestedPublisherId();
		if (empty($publisherId)) {
			$publisherId = $user->id;
		}
	}

	reset($tabs);
	$tab = Q::ifset($_REQUEST, 'tab', key($tabs));

	$stream = Streams_Stream::fetch($user->id, $publisherId, $streamName);
    if (!$stream) {
        throw new Q_Exception_MissingRow(array(
            'table' => 'stream',
            'criteria' => 'with that name'
        ));
	}
	$stream->addPreloaded($user->id);

	if (!$stream->testAdminLevel('own')) {
		throw new Users_Exception_NotAuthorized();
	}

	$access_array = Streams_Access::select()
		->where(array(
			'publisherId' => $stream->publisherId,
			'streamName' => $stream->name,
		))->andWhere("{$tab}Level != -1")->fetchDbRows();
		
	$labelRows = Users_Label::fetch($stream->publisherId, '', array(
		'checkContacts' => true
	));
	$labels = array();
	$icons = array();
	foreach ($labelRows as $label => $row) {
		$labels[$label] = $row->title;
		$icons[$label] = $row->icon;
	}
	
	$userId_list = array();
	foreach ($access_array as $a) {
		if ($a->ofUserId) {
			$userId_list[] = $a->ofUserId;
		}
	}
	$avatar_array = empty($userId_list)
		? array()
		: Streams_Avatar::fetch($user->id, $userId_list);

	switch ($tab) {
		case 'read':
			$levels = $text['readLevelOptions'];
			break;
		case 'write':
			$levels = $text['writeLevelOptions'];
			break;
		case 'admin':
			$levels = $text['adminLevelOptions'];
			break;
	}
	if (isset($ranges[$tab])) {
		$range_min = reset($ranges[$tab]);
		$range_max = end($ranges[$tab]);
		foreach ($levels as $k => $v) {
			if ($k < $range_min) {
				unset($levels[$k]);
			}
			if ($k > $range_max) {
				unset($levels[$k]);
			}
		}
	}
	
	$accessActionUrl = Q_Uri::url("Streams/access"
			. "?publisherId=" . urlencode($publisherId)
			. "&streamName=" . urlencode($streamName));
	
	$dir = Q_Config::get('Users', 'paths', 'icons', 'files/Users/icons');
	
	$accessArray = Db::exportArray($access_array);
	$avatarArray = Db::exportArray($avatar_array);

	if (empty($tabs)) {
		$controls = true;
	}

	if (empty($controls)) {
		Q_Response::addScript("{{Streams}}/js/Streams.js", 'Streams');
		Q_Response::addScript("{{Streams}}/js/tools/access.js", 'Streams');
		Q_Response::addStylesheet("{{Streams}}/css/tools/access.css", 'Streams');
		Q_Response::setToolOptions(@compact(
			'accessArray', 'avatarArray', 'labels', 
			'icons', 'tab', 'publisherId', 
			'streamName'
		));
	} else {
		Q_Response::setSlot('extra', array(
			'stream' => $stream->exportArray(),
			'accessArray' => $accessArray,
			'avatarArray' => $avatarArray,
			'labels' => $labels,
			'icons' => $icons,
			'publisherId' => $publisherId,
			'streamName' => $streamName
		));
	}
	
	return Q::view('Streams/tool/access.php', @compact(
		'stream', 'tabs', 'tab', 'labels', 'icons',
		'levels', 'dir', 'publisherId', 'streamName', 'accessActionUrl',
		'controls'
	));
}