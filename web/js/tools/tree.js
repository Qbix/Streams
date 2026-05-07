(function (Q, $, window, undefined) {

/**
 * Streams/tree — stream relation tree using Q/expandable + Streams/related.
 *
 * Each node is a Q/expandable whose content is a Streams/related tool.
 * Children are loaded lazily on first expand (Streams/related fires on activation).
 * The root node auto-expands on init.
 *
 * @class Streams/tree
 * @constructor
 * @param {Object}  [options]
 * @param {Object}  [options.root]          { publisherId, streamName }
 * @param {Object}  [options.filter]        { types: [], relationTypes: [] }
 * @param {Number}  [options.levels=8]      Max depth from root node
 * @param {Q.Event} [options.onSelect]      fn(publisherId, streamName, stream)
 */
Q.Tool.define("Streams/tree", function (options) {
	var tool  = this;
	var state = tool.state;
	$(tool.element).addClass('Streams_tree_tool');

	if (!state.root || !state.root.publisherId) return;

	// Fetch the root stream, then render it as the top-level expandable node
	Q.Streams.get(state.root.publisherId, state.root.streamName,
	function (err, stream) {
		if (err || !stream) return;

		var $root = $('<div class="Streams_tree_root">');
		$(tool.element).append($root);

		tool._renderNode(
			state.root.publisherId,
			state.root.streamName,
			stream,
			$root,
			0,
			true  // auto-expand the root
		);
	});
},
{
	root:     null,
	filter:   null,
	levels:   8,
	onSelect: new Q.Event()
},
{
	/**
	 * Render a single tree node as a Q/expandable whose content loads
	 * a Streams/related tool when first expanded.
	 *
	 * @method _renderNode
	 * @param {String}  publisherId
	 * @param {String}  streamName
	 * @param {Object}  stream        Q.Streams.Stream object
	 * @param {jQuery}  $container    Element to append this node into
	 * @param {Number}  depth
	 * @param {Boolean} [autoExpand]  If true, expand immediately
	 */
	_renderNode: function (publisherId, streamName, stream, $container, depth, autoExpand) {
		var tool  = this;
		var state = tool.state;

		if (depth >= state.levels) return;

		var title = stream.fields.title || streamName;

		// Build the label element — clicking it fires onSelect
		var $label = $('<span class="Streams_tree_label">').text(title);
		$label.on(Q.Pointer.fastclick, function (e) {
			e.stopPropagation();
			// Highlight selected node
			tool.$('.Streams_tree_label').removeClass('Streams_tree_selected');
			$label.addClass('Streams_tree_selected');
			Q.handle(state.onSelect, tool, [publisherId, streamName, stream]);
		});

		// The expandable content is a placeholder div that gets filled on first expand
		var $childrenPlaceholder = $('<div class="Streams_tree_children_wrap">');

		// Use Q/expandable for expand/collapse with animation
		var $nodeWrap = $('<div class="Streams_tree_node">')
			.attr('data-publisher', publisherId)
			.attr('data-stream',    streamName);

		$nodeWrap.tool('Q/expandable', {
			title:    $label[0],
			content:  $childrenPlaceholder[0],
			expanded: !!autoExpand,
			autoCollapseSiblings: false,
			animation: { duration: 200 },
			onExpand: function () {
				// Load children on first expand — Streams/related handles the rest
				if ($childrenPlaceholder.data('Streams_tree_loaded')) return;
				$childrenPlaceholder.data('Streams_tree_loaded', true);
				tool._loadChildren(publisherId, streamName, $childrenPlaceholder, depth);
			}
		});

		$container.append($nodeWrap);

		// Activate after appending so Q/expandable wires correctly
		Q.activate($nodeWrap[0], function () {
			// If auto-expanding, fire onExpand immediately — children load inside
			if (autoExpand) {
				var expandable = Q.Tool.from($nodeWrap[0], 'Q/expandable');
				if (expandable && !expandable.state.expanded) {
					expandable.expand();
				} else {
					// Already expanded by tool init — trigger load manually
					if (!$childrenPlaceholder.data('Streams_tree_loaded')) {
						$childrenPlaceholder.data('Streams_tree_loaded', true);
						tool._loadChildren(publisherId, streamName, $childrenPlaceholder, depth);
					}
				}
			}
		});
	},

	/**
	 * Load child streams using Streams/related, then render each as a sub-node.
	 * We use Streams/related directly rather than activating a Streams/related tool
	 * so we can recursively call _renderNode for each child and maintain our own
	 * depth counter and filter logic.
	 *
	 * @method _loadChildren
	 * @param {String} publisherId
	 * @param {String} streamName
	 * @param {jQuery} $container
	 * @param {Number} depth
	 */
	_loadChildren: function (publisherId, streamName, $container, depth) {
		var tool   = this;
		var state  = tool.state;
		var filter = state.filter;

		// Determine which relation type to query (if any)
		var relationType = null;
		if (filter && filter.relationTypes && filter.relationTypes.length === 1) {
			relationType = filter.relationTypes[0];
		}

		// Q.Streams.related(publisherId, streamName, isCategory, options, cb)
		// isCategory=true → find FROM streams (children of this category)
		// Type filter goes inside options — it is NOT a positional argument.
		// Callback: (err, relations, streams) — streams keyed by pub+'\t'+name
		var relatedOptions = { limit: 50, orderBy: false };
		if (relationType) relatedOptions.type = relationType;

		Q.Streams.related(
			publisherId, streamName,
			true,
			relatedOptions,
			function (err, relations, streams) {
				if (err || !relations || !relations.length) {
					$container.append(
						$('<div class="Streams_tree_empty">').text('No children.')
					);
					return;
				}

				Q.each(relations, function (i, rel) {
					// Apply multi-type relation filter
					if (filter && filter.relationTypes && filter.relationTypes.length > 1) {
						if (filter.relationTypes.indexOf(rel.type) < 0) return;
					}

					var key    = rel.fromPublisherId + '\t' + rel.fromStreamName;
					var stream = streams && streams[key];

					// Apply stream type filter
					if (stream && filter && filter.types && filter.types.length) {
						if (filter.types.indexOf(stream.fields.type) < 0) return;
					}

					if (!stream) {
						// Stream not returned inline — fetch it
						Q.Streams.get(rel.fromPublisherId, rel.fromStreamName,
						function (err, s) {
							if (err || !s) return;
							tool._renderNode(
								rel.fromPublisherId, rel.fromStreamName,
								s, $container, depth + 1);
						});
					} else {
						tool._renderNode(
							rel.fromPublisherId, rel.fromStreamName,
							stream, $container, depth + 1);
					}
				});
			}
		);
	}
});

})(Q, Q.jQuery, window);
