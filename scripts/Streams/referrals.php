<?php
/**
 * Reconciles Streams_Invite against Users_Referred.
 *
 *   php scripts/Streams/referrals.php --app /path/to/app
 *   php scripts/Streams/referrals.php --app /path/to/app --since 2026-01-01
 *   php scripts/Streams/referrals.php --app /path/to/app --fix
 *
 * REPORT-ONLY BY DEFAULT. It will not write anything unless you pass --fix,
 * and even then it prints every row it touches.
 *
 * That default is deliberate. Users_Referred rows carry points, and points can
 * feed payouts. A script that retroactively creates referral credit is a script
 * that can retroactively create or move money, so the safe shape is: look,
 * read the report, then decide.
 *
 * Note also that this treats a symptom. The underlying cause is in
 * Streams_Invite::accept(), which passes $this->publisherId to
 * handleReferral() as the communityId -- correct when a community publishes the
 * stream, wrong when a person does. Fix that and most of what this script finds
 * stops happening. Running this nightly instead is how you end up with a
 * reconciliation job nobody dares turn off.
 */

$argv = $_SERVER['argv'];
$count = count($argv);

$FIX = false;
$MIGRATE = false;
$SINCE = null;
$LIMIT = 100000;
$APP_DIR = null;

for ($i = 1; $i < $count; ++$i) {
	switch ($argv[$i]) {
		case '--app':   $APP_DIR = $argv[++$i]; break;
		case '--fix':   $FIX = true; break;
		case '--migrate': $MIGRATE = true; break;
		case '--since': $SINCE = $argv[++$i]; break;
		case '--limit': $LIMIT = intval($argv[++$i]); break;
		case '--help':
			echo file_get_contents(__FILE__, false, null, 0, 1600);
			exit(0);
	}
}
if (!$APP_DIR) {
	fwrite(STDERR, "Usage: php referrals.php --app /path/to/app [--since DATE] [--fix] [--migrate]\n");
	exit(1);
}
define('APP_DIR', realpath($APP_DIR));
include(APP_DIR . '/web/Q.inc.php');

echo $FIX
	? "MODE: --fix (will write to users_referred)\n\n"
	: "MODE: report only (pass --fix to write)\n\n";

$criteria = array('state' => 'accepted');
$query = Streams_Invite::select()->where($criteria);
if ($SINCE) {
	$query = $query->where(array('insertedTime >=' => date('Y-m-d H:i:s', strtotime($SINCE))));
}
$invites = $query->orderBy('insertedTime')->limit($LIMIT)->fetchDbRows();

echo "Examining " . count($invites) . " accepted invites\n";

$missing = 0;
$fixed = 0;
$skipped = 0;
$misfiledCount = 0;
$migrated = 0;

foreach ($invites as $invite) {
	if (!$invite->userId or !$invite->invitingUserId) {
		continue;
	}
	$communityId = Streams_Invite::communityIdForReferral($invite);
	if (!$communityId) {
		// nothing to scope the referral to; report rather than guess
		++$skipped;
		echo sprintf(
			"  SKIP    %-12s <- %-12s  (no community resolvable for %s)\n",
			$invite->userId, $invite->invitingUserId, $invite->streamName
		);
		continue;
	}

	$existing = new Users_Referred(array(
		'userId' => $invite->userId,
		'toCommunityId' => $communityId,
		'referredByUserId' => $invite->invitingUserId
	));
	if ($existing->retrieve()) {
		continue; // already credited
	}

	// Before calling this missing, check whether a row exists for the same
	// pair under a DIFFERENT community. That is the signature of the
	// publisherId-as-community bug in accept(): the referral WAS credited, just
	// filed against a user id instead of a community. Crediting again here
	// would leave two rows and double the points, which is worse than the
	// problem being fixed.
	$misfiled = array();
	foreach (Users_Referred::select()->where(array(
		'userId' => $invite->userId,
		'referredByUserId' => $invite->invitingUserId
	))->fetchDbRows() as $other) {
		if ($other->toCommunityId !== $communityId) {
			$misfiled[] = $other;
		}
	}
	if ($misfiled) {
		++$misfiledCount;
		foreach ($misfiled as $other) {
			echo sprintf(
				"  MISFILED %-12s <- %-12s  filed under %-12s should be %-12s (%s pts)\n",
				$invite->userId, $invite->invitingUserId,
				$other->toCommunityId, $communityId, $other->points
			);
		}
		if (!$MIGRATE) {
			echo "           -> not credited; pass --migrate to move it\n";
			continue;
		}
		// migrate: carry the larger point value across, then drop the old row
		$best = 0;
		foreach ($misfiled as $other) {
			$best = max($best, intval($other->points));
		}
		$correct = new Users_Referred(array(
			'userId' => $invite->userId,
			'toCommunityId' => $communityId,
			'referredByUserId' => $invite->invitingUserId
		));
		$correct->retrieve();
		// probe ->fields: Db_Row::__get() throws when retrieve() found nothing
		$had = intval(Q::ifset($correct->fields, 'points', 0));
		$correct->points = max($had, $best);
		$correct->save(true);
		foreach ($misfiled as $other) {
			$other->remove();
		}
		++$migrated;
		echo "           -> migrated to $communityId with {$correct->points} pts\n";
		continue;
	}

	++$missing;
	// Db_Row::__get() throws on fields that were never set, and updatedTime
	// is only populated once a row has actually been updated -- so probe
	// ->fields rather than reading the property.
	$when = Q::ifset($invite->fields, 'updatedTime', null)
		?: Q::ifset($invite->fields, 'insertedTime', '');
	echo sprintf(
		"  MISSING %-12s <- %-12s  community=%-12s accepted=%s\n",
		$invite->userId, $invite->invitingUserId, $communityId,
		substr((string)$when, 0, 10)
	);

	if (!$FIX) {
		continue;
	}

	// Route the write through handleReferral() rather than inserting a row
	// directly, so points config, the Users/referred event and qualification
	// all behave exactly as they would have at the time.
	$result = Users_Referred::handleReferral(
		$invite->userId,
		$communityId,
		'Streams/invite/accept',
		'',
		array('byUserId' => $invite->invitingUserId)
	);
	if ($result === false) {
		echo "          -> handleReferral declined (points config, or no referrer)\n";
	} else {
		++$fixed;
		echo "          -> credited\n";
	}
}

echo "\n";
echo "accepted invites examined : " . count($invites) . "\n";
echo "missing referral rows     : $missing\n";
echo "misfiled (wrong community): $misfiledCount\n";
echo "skipped (no community)    : $skipped\n";
if ($MIGRATE) {
	echo "rows migrated             : $migrated\n";
}
if ($FIX) {
	echo "rows written              : $fixed\n";
} else {
	echo "\nNothing was written. Re-run with --fix once you've read the above.\n";
}
