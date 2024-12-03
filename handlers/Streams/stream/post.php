<?php

/**
 * @module Streams
 */

/**
 * Used by HTTP clients to create a new stream in the system.
 * @class HTTP Streams stream
 * @method post
 * @param {array} [$params] Parameters that can come from the request
 *   @param {string} $params.publisherId  Required. The id of the user to publish the stream.
 *   @param {string} [$params.type] The type of the stream. If stream name defined will try to get type from config, otherwise type should be in request.
 *   @param {string} [$params.name] Optionally set the exact name of the stream to be created. This only works if the name of the stream is in Streams/possibleUserStreams config array, and the logged-inuser has adminLevel >= "own".
 *   @param {boolean|array} [$params.private] Pass true to mark this stream as private, can also be an array containing ["invite"]
 *   @param {string} [$params.Q_Streams_related_publisherId] Optionally indicate the publisher of the stream to relate the newly created to. Used together with the related.streamName option.
 *   @param {string} [$params.Q_Streams_related_streamName] Optionally indicate the name of a stream to relate the newly crated stream to. This is often necessary in order to obtain permissions to create the stream.
 *   @param {bool} [$params.dontSubscribe=false] Pass 1 or true here in order to skip auto-subscribing to the newly created stream.
 *   @param {string} [$params.accessProfileName] The name of the access profile in the config, for this type of stream, if specified it overrides public access saved in templates
 *   @param {boolean} [$params.notices] Pass true to mark this stream as generating notices even if user retained it
 *   @param {array} [$params.icon] This is used to upload a custom icon for the stream which will then be saved in different sizes. See fields for Q/image/post method
 *     @param {string} [$params.icon.data]  Required if $_FILES is empty. Base64-encoded  data URI - see RFC 2397
 *     @param {string} [$params.icon.path="uploads"] parent path under web dir (see subpath)
 *     @param {string} [$params.icon.subpath=""] subpath that should follow the path, to save the image under
 *     @param {string} [$params.icon.merge=""] path under web dir for an optional image to use as a background
 *     @param {string} [$params.icon.crop] array with keys "x", "y", "w", "h" to crop the original image
 *     @param {string} [$params.icon.save=array("x" => "")] array of $size => $basename pairs
 *      where the size is of the format "WxH", and either W or H can be empty.
 *   @param {array} [$params.file] This is used to upload a custom icon for the stream which will then be saved in different sizes. See fields for Q/image/post method
 *     @param {string} [$params.file.data]  Required if $_FILES is empty. Base64-encoded  data URI - see RFC 2397
 *     @param {string} [$params.file.path="uploads"] parent path under web dir (see subpath)
 *     @param {string} [$params.file.subpath=""] subpath that should follow the path, to save the file under
 *     @param {string} [$params.file.name] override name of the file, after the subpath
 */
function Streams_stream_post($params = array())
{
	$user = Users::loggedInUser(true);
	$publisherId = Streams::requestedPublisherId();
	if (empty($publisherId)) {
		$publisherId = $_REQUEST['publisherId'] = $user->id;
	}
	$req = array_merge($_REQUEST, $params);

	// if type not found try to get it from $_REQUEST
	$type = Streams::requestedType();

	// try to get stream type by name from config
	if (!empty($req['name'])) {
		$p = Streams::userStreamsTree();
		$info = $p->get($req['name'], array());
		$mentionedType = Q::ifset($info, "type", null);
		if (!empty($mentionedType)) {
			if (!empty($type) and $mentionedType !== $type) {
				throw new Streams_Exception_Type(array(
					'expectedType' => $mentionedType,
					'type' => $type
				));
			}
			$type = $mentionedType;
		}
	}

	if (empty($type)) {
		throw new Q_Exception_RequiredField(
			array('field' => 'stream type'),
			'streamType'
		);
	}

	$types = Q_Config::expect('Streams', 'types');
    if (!array_key_exists($type, $types)) {
        throw new Q_Exception("This app doesn't support streams of type $type", 'type');
    }
	$create = Streams_Stream::getConfigField($type, 'create', false);
	if (!$create) {
        throw new Q_Exception("This app doesn't let clients directly create streams of type $type", 'type');
	}

	// Should this stream be related to another stream?
	$relate = array();
	$relateStreamName = Q_Request::special("Streams.related.streamName", null, $req);
	if (isset($relateStreamName)) {
		$relate['publisherId'] = Q_Request::special("Streams.related.publisherId", $publisherId, $req);
		$relate['streamName'] = $relateStreamName;
		$relate['inheritAccess'] = filter_var(
			Q_Request::special("Streams.related.inheritAccess", true, $req),
			FILTER_VALIDATE_BOOLEAN
		);
		$relate['type'] = Q_Request::special("Streams.related.type", null, $req);
		$relate['weight'] = Q_Request::special("Streams.related.weight", "+1", $req); // TODO: introduce ways to have "1" and "+1" for some admins etc.
		Q_Valid::requireFields(array('publisherId', 'type'), $relate, true);
	}
	
	// Split the id for saving files in the filesystem
	$splitId = Q_Utils::splitId($publisherId);
	
	// Hold on to any icon that was posted
	$icon = null;
	if (!empty($req['icon']) and is_array($req['icon'])) {
		$icon = $req['icon'];
		unset($req['icon']);
	}

	// Check if the user owns the stream
	if ($user->id === $publisherId) {
		$asOwner = true;
	} else {
		$streamTemplate = Streams_Stream::getStreamTemplate(
			$publisherId, $type, 'Streams_Stream'
		);
		$asOwner = $streamTemplate ? $streamTemplate->testAdminLevel('own') : false;

		if (!$asOwner) {
			$asOwner = (bool)Users::roles($publisherId, Streams_Stream::getConfigField($type, 'admins', array()), array(), $user->id);
		}
	}
	
	// Check if client can set the name of this stream
	if (isset($req['name'])) {
		$possible = Q_Config::get('Streams', 'possibleUserStreams', $req['name'], false);
		if (!$asOwner or !$possible) {
			throw new Users_Exception_NotAuthorized();
		}
	}
	
	// Get allowed fields
	$allowedFields = array_merge(
		array('publisherId', 'name', 'type', 'icon', 'file'),
		Streams::getExtendFieldNames($type, $asOwner)
	);
	$fields = Q::take($req, $allowedFields);

	// Set up options
	$result = null;
	$options = Q::take($req, array('private', 'accessProfileName', 'notices'));
	$options['relate'] = $relate;

	// Prevent setting restricted fields
	if (is_array($create)) {
		$restrictedFields = array_diff($allowedFields, $create);
		foreach ($restrictedFields as $fieldName) {
			if (in_array($fieldName, array('publisherId', 'type'))) {
				continue;
			}
			if (isset($req[$fieldName])) {
				throw new Users_Exception_NotAuthorized();
			}
		}
	}

	$stream = null;

	// if stream name was passed - check whether this stream already exist
	$streamName = Q::ifset($fields, 'name', null);
	if ($streamName) {
		$stream = Streams_Stream::fetch($user->id, $publisherId, $fields['name']);

		// if stream exists - clear closedTime (resurrection)
		if ($stream instanceof Streams_Stream) {
			$stream->closedTime = null;
			$stream->save();
		}
	}

	// if $stream is null - Create new stream
	if (!$stream instanceof Streams_Stream) {
		$stream =  Streams::create($user->id, $publisherId, $type, $fields, $options, $result);
		$streamName = $stream->name;
	}
	$messageTo = false;
	if (isset($result['messagesTo']) && !empty($result['messagesTo'])) {
		$messageTo = reset($result['messagesTo']);
		$messageTo = reset($messageTo);
		if (is_array($messageTo)) {
			$messageTo = reset($messageTo);
		}
		$messageTo = $messageTo->exportArray();
	}
	Q_Response::setSlot('messageTo', $messageTo);

	// Process any icon that was posted
	if ($icon === true) {
		$icon = array();
	}
	if (is_array($icon)) {
		if (empty($icon['path'])) {
			$icon['path'] = 'Q'.DS.'uploads'.DS.'Streams';
		}
		if (empty($icon['subpath'])) {
			$icon['subpath'] = $splitId.DS.$streamName.DS."icon".DS.time();
		}
		Q_Response::setSlot('icon', Q_Image::postNewImage($icon));
		// the Streams/after/Q_image_save hook saves some attributes
	}

	// Process any animated thumbnail that was posted
	$animatedThumbnail = null;
	if (!empty($req['animatedThumbnail'])) {
		$stream->icon = Q_Image::saveAnimatedThumbnail($req['animatedThumbnail'], Streams::iconDirectory($publisherId, $streamName).DS.'animated');
		$stream->changed();
		unset($req['animatedThumbnail']);
	}

	// Process any file that was posted
	$file = null;
	if (!empty($req['file']) and is_array($req['file'])) {
		$file = $req['file'];
		$file["name"] = $req["title"];
		unset($req['file']);

		if (empty($file['path'])) {
			$file['path'] = 'Q'.DS.'uploads'.DS.'Streams';
		}
		if (empty($file['subpath'])) {
			$file['subpath'] = $splitId.DS."{$stream->name}".DS."file".DS.time();
		}
		Q_Response::setSlot('file', Q::event("Q/file/post", $file));
		// the Streams/after/Q_file_save hook saves some attributes
	}

	// Re-fetch the stream object from the Streams::fetch cache,
	// since it might have been retrieved and modified to be different
	// from what is currently in $stream.
	// This also calculates the access levels on the stream.
	$stream = Streams_Stream::fetch($user->id, $publisherId, $stream->name, '*', array(
		'refetch' => true
	));
	
	if (empty($req['dontSubscribe'])) {
		// autosubscribe to streams you yourself create, using templates
		$stream->subscribe();
	}

	Streams::$cache['stream'] = $stream;
	
}
