<?php

/**
 * Cancel access to stream
 * @method delete
 * @param {array} $_REQUEST
 * @param {string} $_REQUEST.publisherId Required. Publisher id of the stream.
 * @param {string} $_REQUEST.streamName Required. Stream name to which access was granted.
 * @param {string} [$_REQUEST.ofUserId] Id of the user to whom access was granted.
 *   Either this or ofContactLabel is required.
 * @param {string} [$_REQUEST.ofContactLabel] Contact label to which access was granted.
 *   Either this or ofUserId is required.
 * @throws {Users_Exception_NotAuthorized} unless the logged-in user has
 *   the "own" admin level on the stream, the same level Streams/access PUT requires
 */
function Streams_access_delete($params) {
	$user = Users::loggedInUser(true);
	// As PUT does. The dispatcher's own nonce check is enforcing only for
	// AJAX requests; a form POST with Q.method=DELETE would skip it.
	Q_Valid::nonce(true);
	$r = array_merge($_REQUEST, $params);
	Q_Valid::requireFields(array('publisherId', 'streamName'), $r, true);
	$ofUserId = Q::ifset($r, 'ofUserId', '');
	$ofContactLabel = Q::ifset($r, 'ofContactLabel', '');
	if (empty($ofUserId) and empty($ofContactLabel)) {
		throw new Q_Exception_RequiredField(array('field' => 'ofUserId or ofContactLabel'));
	}

	// Authorize against the stream, as the logged-in user. The acting user
	// never comes from the request: an earlier version read $_REQUEST['userId']
	// and compared it with publisherId, which any caller could satisfy.
	$stream = Streams_Stream::fetch($user->id, $r['publisherId'], $r['streamName']);
	if (!$stream) {
		throw new Q_Exception_MissingRow(array(
			'table'    => 'stream',
			'criteria' => 'with that name'
		));
	}
	if (!$stream->testAdminLevel('own')) {
		throw new Users_Exception_NotAuthorized();
	}

	$access = new Streams_Access();
	$access->publisherId = $stream->publisherId;
	$access->streamName = $stream->name;
	$access->ofUserId = $ofUserId;
	$access->ofContactLabel = $ofContactLabel;
	if ($access->retrieve()) {
		$access->remove();
	}
}
