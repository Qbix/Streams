<?php

/**
 * Post one or more fields here to change the corresponding basic streams for the logged-in user
 * @param {array} $params Can include the following
 * @param {string} $params.firstName specify the first name directly
 * @param {string} $params.lastName specify the last name directly
 * @param {string} $params.fullName the user's full name, which if provided will be split into first and last name and override them
 * @param {string} $params.gender the user's gender
 * @param {string} $params.birthday_year the year the user was born
 * @param {string} $params.birthday_month the month the user was born
 * @param {string} $params.birthday_day the day the user was born
 */
function Streams_basic_post($params = array())
{
	Q_Valid::nonce(true);
	$request = array_merge($_REQUEST, $params);

	Streams_Internal::updateBasicStreams(Q::ifset($params, 'userId', null), $request);
}
