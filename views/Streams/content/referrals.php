<?php
/**
 * Referrals panel — sortable, responsive table.
 */
$groups = array('discrepancy' => array(), 'credited' => array(), 'notAccepted' => array());
foreach ($rows as $row) {
	if ($row['discrepancy']) { $groups['discrepancy'][] = $row; }
	elseif ($row['accepted']) { $groups['credited'][] = $row; }
	else { $groups['notAccepted'][] = $row; }
}

if (!function_exists('Streams_referrals_table')):
function Streams_referrals_table($rows, $showPoints = true, $tableId = '') {
	if (empty($rows)) return '<p style="opacity:0.5;font-size:13px">None.</p>';
	$html = '<table class="Streams_referrals_table"' . ($tableId ? ' id="' . $tableId . '"' : '') . '>';
	$html .= '<thead><tr>'
		. '<th data-sort="name">Name <span class="Streams_sort_arrow"></span></th>'
		. '<th data-sort="status">Status <span class="Streams_sort_arrow"></span></th>'
		. '<th data-sort="date">Date <span class="Streams_sort_arrow"></span></th>'
		. '<th data-sort="sessions">Sessions <span class="Streams_sort_arrow"></span></th>';
	if ($showPoints) {
		$html .= '<th data-sort="pts">Points <span class="Streams_sort_arrow"></span></th>';
	}
	$html .= '</tr></thead><tbody>';
	foreach ($rows as $r) {
		$badge = $r['accepted']
			? '<span class="Streams_referrals_badge Streams_referrals_accepted">Accepted</span>'
			: '<span class="Streams_referrals_badge Streams_referrals_' . Q_Html::text($r['inviteState']) . '">'
				. ucfirst($r['inviteState']) . '</span>';
		$date = !empty($r['invitedTime'])
			? date('M j, Y', strtotime($r['invitedTime'])) : '—';
		$dateSort = !empty($r['invitedTime'])
			? date('Y-m-d', strtotime($r['invitedTime'])) : '';
		$avatar = Q::tool('Users/avatar', array(
			'userId' => $r['userId'], 'icon' => 40, 'short' => true
		), 'ref-' . $r['userId']);

		$html .= '<tr class="Streams_referrals_row"'
			. ' data-user-id="' . Q_Html::text($r['userId']) . '"'
			. ' data-name="' . Q_Html::text(strtolower($r['displayName'])) . '"'
			. ' data-status="' . Q_Html::text($r['inviteState']) . '"'
			. ' data-date="' . $dateSort . '"'
			. ' data-sessions="' . intval($r['sessionCount']) . '"'
			. ($showPoints ? ' data-pts="' . intval($r['points']) . '"' : '')
			. '>'
			. '<td data-label="Name">' . $avatar . '</td>'
			. '<td data-label="Status">' . $badge . '</td>'
			. '<td data-label="Date">' . $date . '</td>'
			. '<td data-label="Sessions">' . intval($r['sessionCount']) . '</td>';
		if ($showPoints) {
			$pts = intval($r['points']);
			$html .= '<td data-label="Points">'
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
				. Streams_referrals_table($groups['discrepancy'], false, 'Streams_ref_disc')
		), 'disc') ?>
		<?php endif; ?>

		<?php if ($groups['credited']): ?>
		<?php echo Q::tool('Q/expandable', array(
			'title' => 'Credited (' . count($groups['credited']) . ')',
			'expanded' => empty($groups['discrepancy']),
			'autoCollapseSiblings' => false,
			'content' => Streams_referrals_table($groups['credited'], true, 'Streams_ref_cred')
		), 'cred') ?>
		<?php endif; ?>

		<?php if ($groups['notAccepted']): ?>
		<?php echo Q::tool('Q/expandable', array(
			'title' => 'Invited, Not Accepted (' . count($groups['notAccepted']) . ')',
			'expanded' => false,
			'autoCollapseSiblings' => false,
			'content' => Streams_referrals_table($groups['notAccepted'], false, 'Streams_ref_notacc')
		), 'notacc') ?>
		<?php endif; ?>

	<?php endif; ?>
</div>


