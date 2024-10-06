<?php
	
function Streams_1_2_6_1_Streams_local()
{
	echo "Make symlinks for Streams/icons/Streams/video".PHP_EOL;

	$dir = STREAMS_PLUGIN_FILES_DIR.'/Streams/icons/Streams/video/';
	foreach (array(40, 50, 80, 200, 400) as $size) {
		Q_Utils::symlink($dir.$size.'.png', $dir.$size.'x.png');
	}
}

Streams_1_2_6_1_Streams_local();