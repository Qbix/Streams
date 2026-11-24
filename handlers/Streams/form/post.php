<?php

function Streams_form_post($params = array())
{
	if (empty($_REQUEST['inputs'])) {
		throw new Q_Exception_RequiredField(array('field' => 'inputs'));
	}
	$inputs = Q::json_decode($_REQUEST['inputs'], true);
	$user = Users::loggedInUser(true);
	$r = array_merge($_REQUEST, $params);
	$streams = array();
	foreach ($inputs as $name => $info) {
		$inputName = "input_$name";
		if (!isset($r[$inputName])) {
			continue;
		}
		if (!is_array($info) or count($info) < 4) {
			throw new Q_Exception_WrongValue(array(
				'field' => 'inputs',
				'range' => 'array of name => (streamExists, publisherId, streamName, fieldName)'
			));
		}
		list($streamExists, $publisherId, $streamName, $fieldName) = $info;
		$stream = Streams_Stream::fetch(null, $publisherId, $streamName);
		if (!$stream) {
			if ($user->id !== $publisherId
			or !Q_Config::get('Streams', 'possibleUserStreams', $streamName, false)) {
				throw new Users_Exception_NotAuthorized();
			}
			$stream = Streams::create(null, $publisherId, null, array(
				'name' => $streamName
			));
		}
		$attribute = (substr($fieldName, 0, 10) === 'attribute:')
			? substr($fieldName, 10)
			: null;

		// Access checks for this edit, stated against what Streams/stream
		// PUT checks for the same edit:
		// - only fields a client edit can set at all (getExtendFieldNames),
		//   never publisherId, name, type or the counters -- as PUT;
		// - never the whole "attributes" column: attributes are set one at a
		//   time as "attribute:<name>" through setAttribute(), which applies
		//   the restricted prefixes and Streams/attributes/locked, as PUT's
		//   per-key loop does. No in-tree caller sends the whole column;
		// - the type's "edit" config: false refuses, a list limits the
		//   fields -- as PUT;
		// - a type with no "edit" config at all: PUT refuses it; here only
		//   its publisher may write it, because the in-tree caller
		//   (Communities' profile form) writes the user's own
		//   Streams/user/height, a Streams/number/length, which declares
		//   none. An editor of such a stream is refused, as by PUT;
		// - otherwise the publisher, or the "edit" write level -- as PUT,
		//   without PUT's fallback to posting a Streams/suggest;
		// - the access fields need the publisher or "own" -- as PUT.
		// Not checked here, unlike PUT: that the type is listed in
		// Streams/types at all (the no-"edit" rule above covers an
		// unlisted type, which has no "edit" key either).
		$field = $attribute ? 'attributes' : $fieldName;
		$edit = Streams_Stream::getConfigField($stream->type, 'edit', null);
		$isPublisher = ($stream->publisherId === $user->id);
		if (!in_array($field, Streams::getExtendFieldNames($stream->type), true)
		or $fieldName === 'attributes'
		or (!isset($edit) and !$isPublisher)
		or (isset($edit) and !$edit)
		or (is_array($edit) and !in_array($field, $edit, true))
		or (!$isPublisher and !$stream->testWriteLevel('edit'))
		or (in_array($field, array(
			'readLevel', 'writeLevel', 'adminLevel',
			'permissions', 'inheritAccess', 'closedTime'
		), true) and !$isPublisher and !$stream->testAdminLevel('own'))) {
			throw new Users_Exception_NotAuthorized();
		}

		if ($attribute) {
			$stream->setAttribute($attribute, $r[$inputName]);
		} else {
			$stream->$fieldName = $r[$inputName];
		}
		$stream->save();
		$streams[$stream->name] = $stream;
	}
	Q_Response::setSlot('streams', Db::exportArray($streams));
}