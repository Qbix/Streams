<?php

/**
 * @module Streams
 */

/**
 * Class representing workspace rows in the Streams plugin.
 * Workspaces are virtual publisher namespaces of the form "$publisherId~$workspaceName".
 * They allow copy-on-write forking of streams, similar to git branches or ZFS clones.
 * The stack is passed per-request via workspaces[] query parameter — no server-side state.
 * @class Streams_Workspace
 * @extends Base_Streams_Workspace
 */
class Streams_Workspace extends Base_Streams_Workspace
{
    /**
     * Get the workspace stack from the current request.
     * Reads workspaces[] from $_REQUEST.
     * @method fromRequest
	 * @param {array} $options
	 * @param {array} [$options.workspaces]
     * @static
     * @return {array} Ordered array of workspace names, top of stack first.
     */
	static function fromRequest($options = array())
	{
		$workspaces = Q::ifset($options, 'workspaces',
			Q_Request::special('Streams.workspaces', null)
		);
		if (!isset($workspaces)) {
			return array();
		}
		if (is_string($workspaces)) {
			$workspaces = explode(',', $workspaces);
		}
		return array_values(array_filter(array_map('strval', (array)$workspaces)));
	}

    /**
     * Given a base publisherId and a workspace stack, return the full ordered
     * array of publisherIds to use in a CASCADE WHERE clause.
     * e.g. ("alice", ["ws2", "ws1"]) => ["alice~ws2", "alice~ws1", "alice"]
     * The first match in a SELECT wins (most-specific workspace first, base last).
     * @method stackedPublisherIds
     * @static
     * @param {string} $publisherId The base publisher id
     * @param {array} $workspaces Ordered workspace names, top of stack first
     * @return {array} Publisher ids in cascade order
     */
    static function stackedPublisherIds($publisherId, array $workspaces)
    {
        if (empty($workspaces)) {
            return array($publisherId);
        }
        $ids = array();
        foreach ($workspaces as $ws) {
            $ids[] = $publisherId . '~' . $ws;
        }
        $ids[] = $publisherId;
        return $ids;
    }

    /**
     * Given a virtual workspace publisherId like "alice~ws2",
     * return just the workspace name "ws2".
     * Returns null if not a workspace publisherId.
     * @method nameFromPublisherId
     * @static
     * @param {string} $publisherId
     * @return {string|null}
     */
    static function nameFromPublisherId($publisherId)
    {
        $pos = strpos($publisherId, '~');
        if ($pos === false) {
            return null;
        }
        return substr($publisherId, $pos + 1);
    }

    /**
     * Check whether a workspace exists in the database.
     * @method exists
     * @static
     * @param {string} $name
     * @return {boolean}
     */
    static function exists($name)
    {
        $ws = new Streams_Workspace();
        $ws->name = $name;
        return (bool)$ws->retrieve();
    }

    /**
     * Create a workspace if it doesn't already exist.
     * @method ensure
     * @static
     * @param {string} $name
     * @param {string} [$parentName=null]
     * @return {Streams_Workspace}
     */
    static function ensure($name, $parentName = null)
    {
        $ws = new Streams_Workspace();
        $ws->name = $name;
		$ws->parentName = $parentName;
        $ws->save(true);
        return $ws;
    }

    /**
     * Get all ancestors of a workspace, from immediate parent up to root.
     * @method ancestors
     * @static
     * @param {string} $name
     * @return {array} Array of Streams_Workspace objects, nearest first
     */
    static function ancestors($name)
    {
        $result = array();
        $current = $name;
        $seen = array();
        while ($current) {
            if (isset($seen[$current])) break; // cycle guard
            $seen[$current] = true;
            $ws = new Streams_Workspace();
            $ws->name = $current;
            if (!$ws->retrieve()) break;
            $result[] = $ws;
            $current = $ws->parentName;
        }
        array_shift($result); // drop the starting workspace itself
        return $result;
    }

    /**
     * The setUp() method is called the first time
     * an object of this class is constructed.
     * @method setUp
     */
    function setUp()
    {
        parent::setUp();
    }

    /**
     * Implements the __set_state method, so it can work with
     * var_export and be re-imported successfully.
     * @method __set_state
     * @static
     * @param {array} $array
     * @return {Streams_Workspace}
     */
    static function __set_state(array $array)
    {
        $result = new Streams_Workspace();
        foreach ($array as $k => $v) {
            $result->$k = $v;
        }
        return $result;
    }
}