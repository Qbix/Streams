<?php

function Streams_before_Users_user_lastActiveTime($params, &$result)
{
	$userId = $params['userId'];

	$row = Streams_Message::select()
		->where(array(
			'publisherId' => $userId,
			'streamName' => 'Streams/participating'
		))->orderBy('ordinal', false) // newest message first
		->limit(1)
		->fetchDbRow();

	if ($row) {
		$result = Users::db()->fromDateTime($row->insertedTime);
	}
}