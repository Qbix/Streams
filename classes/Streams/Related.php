<?php

/**
 * @module Streams
 */
/**
 * Class with methods common to Streams_RelatedTo and Streams_RelatedFrom
 *
 * @class Streams_Related
 */
class Streams_Related
{
    /**
	 * Filter relations based on the options
	 * @method filter
	 * @static
	 * @param {array} $relations
	 * @param {string|integer} [$options.readLevel] the parameter to pass to testReadLevel()
	 * @param {string|integer} [$options.writeLevel] the parameter to pass to testWriteLevel()
	 * @param {string|integer} [$options.adminLevel] the parameter to pass to testAdminLevel()
	 * @param {string|array} [$options.permission] the parameter to pass to testPermission()
	 * @return {array} The relations that pass the filter
	 */
	static function filter($relations, $options, $isCategory)
	{
        $fieldP = $isCategory ? 'fromPublisherId' : 'toPublisherId';
        $fieldN = $isCategory ? 'fromStreamName' : 'toStreamName';
		$results = array();
		$pns = array();
		$pnr = array();
		foreach ($relations as $r) {
			if ($r->get('public')) {
				$results[] = $r;
			} else {
				$key = $r->$fieldP . "\t" . $r->$fieldN;
				$pns[$r->$fieldP][] = $r->$fieldN;
				$pnr[$key] = $r;
			}
		}
		foreach ($pns as $publisherId => $streamNames) {
			$streams = Streams::fetch(null, $publisherId, $streamNames);
			foreach ($streams as $s) {
				if (!empty($options['readLevel']) && !$s->testReadLevel($options['readLevel'])) {
					continue;
				}
				if (!empty($options['writeLevel']) && !$s->testWriteLevel($options['writeLevel'])) {
					continue;
				}
				if (!empty($options['adminLevel']) && !$s->testAdminLevel('adminLevel')) {
					continue;
				}
				if (!empty($options['permission']) && !$s->testPermission('permission')) {
					continue;
				}
				$key = $s->publisherId . "\t" . $s->name;
				$results[] = $pnr[$key];
			}
		}
		Q::	var_dump($results);exit;
		return $results;
	}
    
}