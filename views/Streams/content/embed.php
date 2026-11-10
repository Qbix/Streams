<?php
/**
 * Content view for a Streams/embed page. The outer page is minimal; the
 * actual embed renders through the Streams/embed tool whose options were
 * set by the handler. The lazyload wrapper ties tool activation to
 * scroll visibility, so a long embed stays efficient on first paint.
 *
 * Options passed in by Streams_embed_response:
 *   publisherId, streamName, title
 */
?>
<div id="content" class="Streams_embed_page">
	<?php echo Q::tool('Streams/embed'); ?>
</div>
