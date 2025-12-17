<?php

/**
 * @module Streams
 */

/**
 * @module Streams
 */
/**
 * Used by HTTP clients to fetch relations and related streams
 * @class HTTP Streams related
 * @method get
 * @param {array} [$_REQUEST] Parameters that can come from the request
 *   @param {string} $_REQUEST.publisherId  Required. The user id of the publisher of the stream.
 *   @param {string} $_REQUEST.streamName  Required. The name of the stream.
 *   @param {string|array} $_REQUEST.type  The type of the relation.  Can be a string or an array of strings.
 *     If passed as a range, use optional `type[min]`, `type[max]`, `type[includeMin]`, `type[includeMax]`. At least one must be present.
 *     This allows for prefix-based or range-based filtering of relation types.
 *   @param {boolean} [$_REQUEST.isCategory=true] Whether to fetch streams related TO this stream (as category).
 *   @param {boolean} [$_REQUEST.ascending=false] Whether to sort by ascending instead of descending weight.
 *   @param {boolean} [$_REQUEST.omitRedundantInfo=false] Whether to omit redundant publisherId and streamName fields in the output.
 *   @param {integer} [$_REQUEST.messages=0] Number of recent messages to include.
 *   @param {string} [$_REQUEST.messageType] Type of messages to include.
 *   @param {integer} [$_REQUEST.participants=0] Number of participants to include.
 *   @param {boolean} [$_REQUEST.dontFilterUsers=false] Whether to skip filtering using Users/filter/users event.
 */
function Streams_related_response()
{
	$slots = Q_Request::slotNames();

	$relations_requested = in_array('relations', $slots);
	$streams_requested = in_array('relatedStreams', $slots);
	$nodeUrls_requested = in_array('nodeUrls', $slots);

	$user = Users::loggedInUser();
	$asUserId = $user ? $user->id : '';

	if (!$relations_requested && !$streams_requested && !$nodeUrls_requested) {
		return;
	}

	$publisherId = Streams::requestedPublisherId(true);
	$streamName = Streams::requestedName(true, 'original');

	if (!$relations_requested && !$streams_requested) {
		if (empty(Q_Utils::$nodeUrlRouters)) {
			$nodeUrls = array(Q_Uri::proxySource(Q_Utils::nodeUrl()));
			$stream = Streams_Stream::fetch($asUserId, $publisherId, $streamName);
			Q_Response::setSlot('nodeUrls', $nodeUrls);
			Q_Response::setSlot('stream', $stream->exportArray());
			return;
		}
	}

	$isCategory = !(empty($_REQUEST['isCategory']) || strtolower($_REQUEST['isCategory']) === 'false');
	$withParticipant = Q::ifset($_REQUEST, 'withParticipant', true) === "false" ? false : true;

	$options = Q::take($_REQUEST, array(
		'limit', 'offset', 'min', 'max', 'type', 'prefix', 'filter', 'dontFilterUsers'
	));
	$options['relationsOnly'] = !$streams_requested;
	$options['orderBy'] = filter_var(Q::ifset($_REQUEST, 'ascending', 'false'), FILTER_VALIDATE_BOOLEAN);
	$options['fetchOptions'] = @compact('withParticipant');

	// Construct type filter as Db_Range if applicable
	if (
		is_array($_REQUEST) &&
		(
			isset($_REQUEST['type[min]']) ||
			isset($_REQUEST['type[max]']) ||
			isset($_REQUEST['type[includeMin]']) ||
			isset($_REQUEST['type[includeMax]'])
		)
	) {
		$options['type'] = new Db_Range(
			$_REQUEST['type[min]'] ?? null,
			isset($_REQUEST['type[includeMin]']) ? !!$_REQUEST['type[includeMin]'] : true,
			isset($_REQUEST['type[includeMax]']) ? !!$_REQUEST['type[includeMax]'] : true,
			$_REQUEST['type[max]'] ?? null
		);
	}

	$result = Streams::related(
		$asUserId,
		$publisherId,
		$streamName,
		$isCategory,
		$options
	);

	$fields = Q::ifset($_REQUEST, 'fields', null);
	$exportOptions = array('numeric' => true);
	if (isset($fields)) {
		if (is_string($fields)) {
			$fields = array_map('trim', explode(',', $fields));
		}
		$exportOptions['fields'] = $fields;
	}
	if ($streams_requested) {
		$rel = Db::exportArray($result[0], $exportOptions);
		$stream = $result[2];
	} else {
		$rel = Db::exportArray($result, $exportOptions);
		$stream = Streams_Stream::fetch($asUserId, $publisherId, $streamName);
	}

	if ($relations_requested) {
		if (!empty($_REQUEST['omitRedundantInfo'])) {
			if ($isCategory) {
				foreach ($rel as &$r) {
					unset($r['toPublisherId'], $r['toStreamName']);
				}
			} else {
				foreach ($rel as &$r) {
					unset($r['fromPublisherId'], $r['fromStreamName']);
				}
			}
		}
		Q_Response::setSlot('relations', $rel);
	} else {
		Q_Response::setSlot('relations', array());
	}

	if ($nodeUrls_requested) {
		$nodeUrls = array();
		foreach ($rel as $r2) {
			$far = $isCategory ? 'from' : 'to';
			$farPublisherId = $far . 'PublisherId';
			$farStreamName = $far . 'StreamName';
			$nodeUrl = Q_Utils::nodeUrl(array(
				'publisherId' => $r2[$farPublisherId],
				'streamName' => $r2[$farStreamName]
			));
			$nodeUrls[$nodeUrl] = true;
		}
		Q_Response::setSlot('nodeUrls', array_keys($nodeUrls));
	}

	if ($streams_requested) {
		$streams = $result[1];
		$arr = Db::exportArray($streams, array('numeric' => true,));
		foreach ($arr as $k => $v) {
			if (!$v) continue;
			$s = $streams[$v[Q_Models::fieldKey('Streams_Stream', 'name')]];
			if (!$s and isset($streams[$v[1]])) {
				$s = $streams[$v[1]];
			}
			$fn = Q_Models::fieldKey('Streams_Stream', 'access');
!			$arr[$k][$fn] = array(
				'readLevel' => $s->get('readLevel', $s->readLevel),
				'writeLevel' => $s->get('writeLevel', $s->writeLevel),
				'adminLevel' => $s->get('adminLevel', $s->adminLevel)
			);
		}
		Q_Response::setSlot('relatedStreams', $arr);
	}

	if (is_array($stream)) {
		Q_Response::setSlot('streams', Db::exportArray($stream));
	} else if (is_object($stream)) {
		Q_Response::setSlot('stream', $stream->exportArray());
	} else {
		Q_Response::setSlot('stream', false);
	}

	if (!empty($_REQUEST['messages'])) {
		$max = -1;
		$limit = $_REQUEST['messages'];
		$messages = false;
		$type = Q::ifset($_REQUEST, 'messageType', null);
		if ($stream->testReadLevel('messages')) {
			$messages = Db::exportArray($stream->getMessages(compact('type', 'max', 'limit')));
		}
		Q_Response::setSlot('messages', $messages);
	}
	if (!empty($_REQUEST['participants'])) {
		$limit = $_REQUEST['participants'];
		$offset = 0;
		$state = 'participating';
		$participants = false;
		if ($stream->testReadLevel('participants')) {
			$participants = Db::exportArray($stream->getParticipants(@compact(
				'limit', 'offset', 'state'
			)));
		}
		Q_Response::setSlot('participants', $participants);
	}
}
