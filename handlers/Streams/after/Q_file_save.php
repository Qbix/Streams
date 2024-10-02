<?php

function Streams_after_Q_file_save($params)
{
	$path = $subpath = $name = $writePath = $data = $tailUrl = $size = $audio = null;
	extract($params, EXTR_OVERWRITE);
	if (!empty(Streams::$cache['canWriteToStream'])) {
		// some stream's associated file was being changed
		$stream = Streams::$cache['canWriteToStream'];
	}
	if (empty($stream)) {
		return;
	}

	$filename = $writePath.$name;
	$mimeType = finfo_file(finfo_open(FILEINFO_MIME_TYPE), $filename);

	$url = Q_Valid::url($tailUrl) ? $tailUrl : '{{baseUrl}}/'.$tailUrl;
	$url = str_replace('\\', '/', $url);
	$stream->setAttribute('Q.file.url', $url);
	$stream->setAttribute('Q.file.size', $size);
	if ($audio) {
		$getID3 = new Audio_getID3;
		$meta = $getID3->analyze($filename);
		$bitrate = Q::ifset($meta, 'audio', 'bitrate', 128000);
		$bits = $size * 8;
		$duration = $bits / $bitrate;
		$stream->setAttribute('Q.audio.bitrate', $bitrate);
		$stream->setAttribute('Q.audio.duration', $duration);
	}
	if (Streams_Stream::getConfigField($stream->type, 'updateTitle', false)) {
		// set the title every time a new file is uploaded
		$stream->title = $name;
	}
	if (Streams_Stream::getConfigField($stream->type, 'updateIcon', false)) {
		// set the icon every time a new file is uploaded
		$parts = explode('.', $name);
		$urlPrefix = '{{baseUrl}}/{{Streams}}/img/icons/files';
		$dirname = STREAMS_PLUGIN_FILES_DIR.DS.'Streams'.DS.'icons'.DS.'files';
		$extension = end($parts);
		$stream->icon = file_exists($dirname.DS.$extension)
			? "$urlPrefix/$extension"
			: "$urlPrefix/_blank";
	}
	if (empty(Streams::$beingSavedQuery)) {
		$stream->changed();
	} else {
		$stream->save();
	}

	// video files handler
	if (preg_match("/^video/", $mimeType)) {
		// copy Q.file.save attribute to videoUrl attribute to know that video
		$stream->setAttribute("Streams.videoUrl", $url);
		$stream->changed();

		$qVideo = new Q_Video();
		//$qVideo->convert($filename, compact("stream"));
		if ($qVideo->upload($filename, compact("stream"))) {
			// remove local uploaded file if uploaded to video provider
			// and stream url has been updated
			@unlink($filename);

			// make any actions after processed
			$qVideo->processed($stream);
		}
	}
}