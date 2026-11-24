<?php
/**
 * Keeps the stored Streams/user/profile title and icon in step after one of
 * the publisher's name streams changed. The title is what the public sees
 * (asUserId ""), not what the publisher sees of themselves.
 * The rows are arrays of avatar fields, not Streams_Avatar objects.
 */
function Streams_after_Streams_updateAvatars ($params) {

	$rows_that_show = Q::ifset($params, 'rows_that_show', array());
	$rows_that_hide = Q::ifset($params, 'rows_that_hide', array());

	$processed = array();
	foreach (array_merge($rows_that_show, $rows_that_hide) as $avatar) {
		$publisherId = Q::ifset($avatar, 'publisherId', null);
		if (!$publisherId or isset($processed[$publisherId])) {
			continue;
		}
		$processed[$publisherId] = true;

		$stream = Streams_Stream::fetch($publisherId, $publisherId, "Streams/user/profile");
		if (!$stream) {
			continue;
		}
		$stream->title = Streams::displayName($publisherId, array('asUserId' => ''));
		$stream->icon = Q::ifset($avatar, 'icon', $stream->icon);
		$stream->save();
	}
}
