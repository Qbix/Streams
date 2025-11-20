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
 * @param {array|string} [$options.filter] associative array with keys "read", "write", "admin" and values as arrays of level integers for which there are labels, or values can be "simple"
 * @param {boolean} [$options.controls] optionally set this to true to render only the controls
 */
function Streams_access_tool($options)
{
	extract($options);
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
	$stream = Streams_Stream::fetch($user->id, $publisherId, $streamName);
    if (!$stream) {
        throw new Q_Exception_MissingRow(array(
            'table' => 'stream',
            'criteria' => 'with that name'
        ));
	}
	$stream->addPreloaded($user->id);

	$defaults = Streams_Stream::getConfigField(
		$stream->type, array('access'), array()
	);
	$options = array_merge($defaults, $options);

	extract($options);
	$tabNames = isset($tabs) ? $tabs : array('read', 'write', 'admin');

	$text = Q_Text::get('Streams/access');
	$tabs = array(
		'read'  => $text['tabs']['Read'], 
		'write' => $text['tabs']['Write'], 
		'admin' => $text['tabs']['Admin']
	);
	$tabs = Q::take($tabs, $tabNames);

	reset($tabs);
	$tab = Q::ifset($_REQUEST, 'tab', key($tabs));
	if (!isset($tabs[$tab])) {
		$tab = key($tabs);
	}

	if (!$stream->testAdminLevel('own')) {
		throw new Users_Exception_NotAuthorized();
	}

	$access_array = Streams_Access::select()
		->where(array(
			'publisherId' => $stream->publisherId,
			'streamName' => $stream->name,
		))->andWhere("{$tab}Level != -1")->fetchDbRows();
		
	$labelRows = Users_Label::fetch($stream->publisherId, '', array(
		'checkContacts' => false
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
		$range_min = $ranges[$tab]['min'];
		$range_max = $ranges[$tab]['max'];
		foreach ($levels as $k => $v) {
			if ($k < $range_min) {
				unset($levels[$k]);
			}
			if ($k > $range_max) {
				unset($levels[$k]);
			}
		}
	}
	if (isset($filter[$tab])) {
		if ($filter[$tab] === 'simple') {
			switch ($tab) {
				case 'read':
					$filter[$tab] = array(10, 23, 40);
					break;
				case 'write':
					$filter[$tab] = array(0, 30, 40);
					break;
				case 'admin':
					$filter[$tab] = array(0, 10, 20, 30);
					break;
			}
		}
		$keys = array_intersect($filter[$tab], array_keys($levels));
		$levels = Q::take($levels, $keys);
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