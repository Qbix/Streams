<?php
/**
 * Vote -> Streams_RelatedTo.weight bridge.
 *
 * Generic substrate primitive: when accumulated vote weight for a relation
 * changes, mirror Users_Total.value into Streams_RelatedTo.weight so any
 * caller of Streams::related(..., orderBy: 'weight DESC') sees vote-ranked
 * ordering without app-side scoring code.
 *
 * Casting a vote that ranks a relation:
 *
 *   $forId = implode("\t", array(
 *       $fromPublisherId, $fromStreamName,
 *       $relationType,
 *       $toPublisherId, $toStreamName
 *   ));
 *   Users_Vote::vote('Streams/relatedTo', array($forId), array(1),
 *       array($weight), $userId);
 *
 * The separator is TAB (\t), per Qbix forId convention. Tabs cannot appear
 * in publisherIds (alphanumeric + limited symbols) or streamNames (paths
 * that may contain slashes but never tabs), so the encoding is
 * unambiguous and the parse below is exact.
 *
 * Use cases:
 *   - Cover-flow ordering of child streams in a category
 *   - M-of-N approval: relation weight crosses a threshold when enough
 *     signers vote with weight=signerWeight, value=1
 *   - Reordering bookmarks, playlists, queues by community vote
 *
 * Plugins with custom forType values (e.g. Safebots/negotiation/sign for
 * lock signing) can register their own handler for this same event and
 * branch on $total->forType. Multiple handlers fire in order; no conflict
 * as long as each branches on its own forType prefix.
 */
function Streams_after_Users_Total_saveExecute($params)
{
	$total = $params['row'];
	if ($total->forType !== 'Streams/relatedTo') return;

	$parts = explode("\t", $total->forId);
	if (count($parts) !== 5) return;
	list($fromPub, $fromName, $relType, $toPub, $toName) = $parts;

	try {
		Streams::updateRelation($fromPub, $fromName, $relType,
			$toPub, $toName, array('weight' => $total->value));
	} catch (Exception $e) {
		// Relation may not yet exist (vote cast before relate); ignore.
		// Once the relation is created the next vote will succeed.
	}
}
