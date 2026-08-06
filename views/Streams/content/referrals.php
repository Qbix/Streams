<?php
/**
 * Referrals panel.
 *
 * One column, several Q/expandable groups -- no tabs, since this is a single
 * destination rather than a navigation root. The grouping is the point: the
 * two "needs attention" groups are what a person acts on, so those start
 * expanded and the settled ones start collapsed.
 *
 * What each group means, because the distinction matters:
 *  - "Credited" is the normal, correct end state.
 *  - "Accepted, but no referral recorded" means a hook didn't fire. This is
 *    what scripts/Streams/referrals.php reconciles.
 *  - "Invited, not accepted" is NOT a problem. Users_Referred is only supposed
 *    to be written on acceptance. These are shown so the linkage is visible.
 */

$groups = array('discrepancy' => array(), 'credited' => array(), 'notAccepted' => array());
foreach ($rows as $row) {
	if ($row['discrepancy']) { $groups['discrepancy'][] = $row; }
	else if ($row['accepted']) { $groups['credited'][] = $row; }
	else { $groups['notAccepted'][] = $row; }
}

function Streams_referrals_line($row)
{
	$avatar = Q::tool('Users/avatar', array(
		'userId' => $row['userId'], 'icon' => 40, 'short' => true
	), 'r-' . $row['userId']);

	$when = $row['invitedTime']
		? Q_Html::text(date('M j, Y', strtotime($row['invitedTime'])))
		: '';

	$state = $row['accepted']
		? '<span class="Streams_referrals_badge Streams_referrals_badge_accepted">Accepted</span>'
		: '<span class="Streams_referrals_badge Streams_referrals_badge_'
			. Q_Html::text($row['inviteState']) . '">'
			. Q_Html::text(ucfirst($row['inviteState'])) . '</span>';

	if ($row['referredRow']) {
		$credit = '<span class="Streams_referrals_points">' . intval($row['points']) . ' pts</span>';
		if (!$row['qualifiedTime']) {
			$credit .= '<span class="Streams_referrals_pending">not yet qualified</span>';
		}
	} else if ($row['discrepancy']) {
		$credit = '<span class="Streams_referrals_missing">not credited</span>';
	} else {
		$credit = '<span class="Streams_referrals_none">&mdash;</span>';
	}

	return '<div class="Streams_referrals_line" data-user-id="' . Q_Html::text($row['userId']) . '">'
		. '<div class="Streams_referrals_who">' . $avatar . '</div>'
		. '<div class="Streams_referrals_meta">' . $state
			. '<span class="Streams_referrals_when">' . $when . '</span>'
			. '<span class="Streams_referrals_sessions">' . intval($row['sessionCount']) . ' sessions</span>'
		. '</div>'
		. '<div class="Streams_referrals_credit">' . $credit . '</div>'
		. '</div>';
}

function Streams_referrals_group($rows) {
	$out = array();
	foreach ($rows as $row) { $out[] = Streams_referrals_line($row); }
	return implode("\n", $out);
}
?>
<div class="Streams_referrals">

	<div class="Streams_referrals_summary">
		<div class="Streams_referrals_stat">
			<span class="Streams_referrals_number"><?php echo $summary['people'] ?></span>
			<span class="Streams_referrals_label">people</span>
		</div>
		<div class="Streams_referrals_stat">
			<span class="Streams_referrals_number"><?php echo $summary['accepted'] ?></span>
			<span class="Streams_referrals_label">accepted</span>
		</div>
		<div class="Streams_referrals_stat">
			<span class="Streams_referrals_number"><?php echo $summary['points'] ?></span>
			<span class="Streams_referrals_label">points</span>
		</div>
	</div>

	<?php if (empty($rows)): ?>
		<div class="Streams_referrals_empty">
			You haven't invited anyone yet. People you invite show up here once
			they've signed in at least once.
		</div>
	<?php else: ?>

		<?php if ($groups['discrepancy']): ?>
		<?php echo Q::tool('Q/expandable', array(
			'title' => 'Accepted, but no referral recorded',
			'count' => count($groups['discrepancy']),
			'expanded' => true,
			'autoCollapseSiblings' => false,
			'content' => '<div class="Streams_referrals_note">These people accepted an '
				. 'invite from you, but nothing was credited &mdash; usually the referral '
				. 'hook did not fire at the time.</div>'
				. Streams_referrals_group($groups['discrepancy'])
		), 'discrepancy') ?>
		<?php endif; ?>

		<?php if ($groups['credited']): ?>
		<?php echo Q::tool('Q/expandable', array(
			'title' => 'Credited',
			'count' => count($groups['credited']),
			'expanded' => empty($groups['discrepancy']),
			'autoCollapseSiblings' => false,
			'content' => Streams_referrals_group($groups['credited'])
		), 'credited') ?>
		<?php endif; ?>

		<?php if ($groups['notAccepted']): ?>
		<?php echo Q::tool('Q/expandable', array(
			'title' => 'Invited, not accepted',
			'count' => count($groups['notAccepted']),
			'expanded' => false,
			'autoCollapseSiblings' => false,
			'content' => '<div class="Streams_referrals_note">These people followed your '
				. 'invite and signed in, but never accepted. No referral is recorded, '
				. 'which is correct &mdash; they are here so the connection is visible.</div>'
				. Streams_referrals_group($groups['notAccepted'])
		), 'notAccepted') ?>
		<?php endif; ?>

	<?php endif; ?>

</div>
