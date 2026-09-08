<?php

/**
 * Agreements are immutable once anyone has signed.
 *
 * Editing published terms would leave every earlier signature pointing at text
 * the signer never saw, so the change is refused here rather than caught in a
 * dispute later. Publish a new version instead.
 */
function Streams_before_Streams_Stream_save_Streams_agreement($params)
{
	$stream = $params['stream'];
	$modified = $params['modifiedFields'];

	// On the very first save there is nothing to protect yet.
	if (!$stream->wasRetrieved()) {
		return;
	}
	$guarded = array('content', 'title', 'attributes');
	$touched = array_intersect(array_keys($modified), $guarded);
	if (!$touched) {
		return;
	}
	// Not $stream->participatingCount: the DB column is updated immediately by
	// join(), but that is a field on whichever object loaded the row, and this
	// handler often runs on an instance fetched before the signature existed.
	// Count the rows so the guard cannot be fooled by a stale object.
	$signed = (int)Streams_Participant::select('COUNT(1)')->where(array(
		'publisherId' => $stream->publisherId,
		'streamName' => $stream->name,
		'state' => 'participating'
	))->ignoreCache()->fetchAll(PDO::FETCH_COLUMN)[0];

	if ($signed > 0) {
		throw new Q_Exception(
			"Streams/agreement {$stream->name} has signatures and cannot be edited "
			. "($signed signature(s); tried to change: " . implode(', ', $touched) . "). Publish a new version."
		);
	}
}
