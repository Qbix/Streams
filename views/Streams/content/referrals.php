<?php
/**
 * Referrals panel — table-based layout.
 *
 * Three groups (Q/expandable):
 *   Discrepancies — accepted but no referral row — needs attention
 *   Credited      — the normal end state
 *   Not accepted  — linkage, not a problem
 */
$groups = array('discrepancy' => array(), 'credited' => array(), 'notAccepted' => array());
foreach ($rows as $row) {
	if ($row['discrepancy']) { $groups['discrepancy'][] = $row; }
	elseif ($row['accepted']) { $groups['credited'][] = $row; }
	else { $groups['notAccepted'][] = $row; }
}

if (!function_exists('Streams_referrals_table')):
function Streams_referrals_table($rows, $showPoints = true) {
	if (empty($rows)) return '<p style="opacity:0.5;font-size:13px">None.</p>';
	$html = '<table class="Streams_referrals_table">';
	$html .= '<thead><tr>'
		. '<th class="Streams_referrals_th_name">Name</th>'
		. '<th class="Streams_referrals_th_status">Status</th>'
		. '<th class="Streams_referrals_th_date">Date</th>'
		. '<th class="Streams_referrals_th_sessions">Sessions</th>';
	if ($showPoints) {
		$html .= '<th class="Streams_referrals_th_pts">Points</th>';
	}
	$html .= '</tr></thead><tbody>';
	foreach ($rows as $r) {
		$badge = $r['accepted']
			? '<span class="Streams_referrals_badge Streams_referrals_accepted">Accepted</span>'
			: '<span class="Streams_referrals_badge Streams_referrals_' . Q_Html::text($r['inviteState']) . '">'
				. ucfirst($r['inviteState']) . '</span>';
		$date = !empty($r['invitedTime'])
			? date('M j, Y', strtotime($r['invitedTime'])) : '—';
		$avatar = Q::tool('Users/avatar', array(
			'userId' => $r['userId'], 'icon' => 40, 'short' => true
		), 'ref-' . $r['userId']);

		$html .= '<tr class="Streams_referrals_row" data-user-id="' . Q_Html::text($r['userId']) . '">'
			. '<td class="Streams_referrals_td_name">' . $avatar . '</td>'
			. '<td class="Streams_referrals_td_status">' . $badge . '</td>'
			. '<td class="Streams_referrals_td_date">' . $date . '</td>'
			. '<td class="Streams_referrals_td_sessions">' . intval($r['sessionCount']) . '</td>';
		if ($showPoints) {
			$pts = intval($r['points']);
			$html .= '<td class="Streams_referrals_td_pts">'
				. ($pts > 0 ? '<strong>' . $pts . '</strong>' : '<span style="opacity:0.3">0</span>')
				. '</td>';
		}
		$html .= '</tr>';
	}
	$html .= '</tbody></table>';
	return $html;
}
endif;
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
		<div class="Streams_referrals_empty">No referrals yet.</div>
	<?php else: ?>

		<?php if ($groups['discrepancy']): ?>
		<?php echo Q::tool('Q/expandable', array(
			'title' => 'Needs Attention (' . count($groups['discrepancy']) . ')',
			'expanded' => true,
			'autoCollapseSiblings' => false,
			'content' => '<p class="Streams_referrals_note">Accepted the invite, but no referral was recorded. '
				. 'Run the reconciliation script to fix.</p>'
				. Streams_referrals_table($groups['discrepancy'], false)
		), 'disc') ?>
		<?php endif; ?>

		<?php if ($groups['credited']): ?>
		<?php echo Q::tool('Q/expandable', array(
			'title' => 'Credited (' . count($groups['credited']) . ')',
			'expanded' => empty($groups['discrepancy']),
			'autoCollapseSiblings' => false,
			'content' => Streams_referrals_table($groups['credited'])
		), 'cred') ?>
		<?php endif; ?>

		<?php if ($groups['notAccepted']): ?>
		<?php echo Q::tool('Q/expandable', array(
			'title' => 'Invited, Not Accepted (' . count($groups['notAccepted']) . ')',
			'expanded' => false,
			'autoCollapseSiblings' => false,
			'content' => Streams_referrals_table($groups['notAccepted'], false)
		), 'notacc') ?>
		<?php endif; ?>

	<?php endif; ?>
</div>
