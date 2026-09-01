<?php
$_composerAutoload = STREAMS_PLUGIN_DIR.DS.'vendor'.DS.'autoload.php';
if (file_exists($_composerAutoload)) {
	require_once $_composerAutoload; // optional: plugin works without it
}


/**
 * @module Streams
 */

/**
 * Managing files/folders and streams that represent them
 * @class HTTP Streams fileManager
 * @method post
 * @param {array} [$_REQUEST] Parameters that can come from the request
 * @return {void}
 */
function Streams_fileManager_post($params = array())
{
    if(Q_Request::slotName('initRequest')) {

    }

}