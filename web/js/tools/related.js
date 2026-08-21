(function (Q, $) {

/**
 * @module Streams-tools
 */

var Users = Q.Users;
var Streams = Q.Streams;

function _coverflowRenderer(stream, previewTool, callback) {
	var type = stream.fields.type || '';
	var isVideo = (type.indexOf('video') >= 0);
	var el = isVideo ? document.createElement('video') : document.createElement('img');

	if (isVideo) {
		el.setAttribute('playsinline', '');
		el.setAttribute('muted', '');
		el.setAttribute('loop', '');
		el.setAttribute('autoplay', '');
		var attrs = {};
		try { attrs = JSON.parse(stream.fields.attributes || '{}'); } catch (e) {}
		if (attrs.url) { el.src = attrs.url; }
	}

	el.setAttribute('title', stream.fields.title || '');
	el.setAttribute('alt', stream.fields.title || '');

	if (isVideo) {
		callback(el);
	} else {
		previewTool.icon(el, function () {
			callback(el);
		});
	}
}

function _compileHandlebarsRenderer(template) {
	var compiled = Handlebars.compile(template);
	return function (stream, previewTool, callback) {
		var html = compiled({
			publisherId: stream.fields.publisherId,
			streamName: stream.fields.name,
			streamType: stream.fields.type,
			title: stream.fields.title,
			icon: Q.Streams.iconUrl(stream.fields.icon, 200),
			url: Q.Streams.Stream.url(
				stream.fields.publisherId,
				stream.fields.name,
				stream.fields.type
			)
		});
		var wrapper = document.createElement('div');
		wrapper.innerHTML = html;
		callback(wrapper.firstChild);
	};
}

/**
 * Renders a bunch of Stream/preview tools for streams related to the given stream.
 * Has options for adding new related streams, as well as sorting the relations, etc.
 * Also can integrate with Q/tabs tool to render tabs "related" to some category.
 * When Q/coverflow is activated on the same element, automatically switches to
 * a lightweight renderer mode: preview tools are retained (realtime, onInvoke, access
 * control all work) but are kept hidden, and a per-stream rendered element (img, video,
 * or custom) is fed to Q/coverflow instead of the full preview DOM.
 * @class Streams related
 * @constructor
 * @param {Object} [options] options for the tool
 *   @param {String} [options.publisherId] Either this or "stream" is required. Publisher id of the stream to which the others are related
 *   @param {String} [options.streamName] Either this or "stream" is required. Name of the stream to which the others are related
 *   @param {String} [options.tag="div"] The type of element to contain the preview tool for each related stream.
 *   @param {Q.Streams.Stream} [options.stream] You can pass a Streams.Stream object here instead of "publisherId" and "streamName"
 *   @param {String} [options.relationType=null] The type of the relation. If empty, will try to show all relations.
 *   @param {Boolean} [options.isCategory=true] Whether to show the streams related TO this stream, or the ones it is related to.
 *   @param {Object} [options.relatedOptions] Can include options like 'limit', 'offset', 'ascending', 'min', 'max', 'prefix', 'fields', and 'dontFilterUsers'
 *   @param {Boolean} [options.editable] Set to false to avoid showing even authorized users an interface to replace the image or text of related streams
 *   @param {Boolean} [options.closeable] Set to false to avoid showing even authorized users an interface to close related streams
 *   @param {Boolean} [options.composerPosition=null] Can be "first" or "last". Where to place composer in a tool. If null, composer arranged by relatedOptions.ascending.
 *   @param {Object} [options.previewOptions] Object of options which can be passed to Streams/preview tool.
 *   @param {Object} [options.specificOptions] Object of options which can be passed to $streamType/preview tool.
 *   @param {Object} [options.creatable]  Optional pairs of {streamType: toolOptions} to render Streams/preview tools create new related streams.
 *   The params typically include at least a "title" field which you can fill with values such as "New" or "New ..."
 *   @param {Function} [options.toolName] Function that takes (streamType, options) and returns the name of the tool to render (and then activate) for that stream. That tool should reqire the "Streams/preview" tool, and work with it as documented in "Streams/preview".
 *   @param {Boolean} [options.realtime=false] Whether to refresh every time a relation is added, removed or updated by anyone
 *   @param {Object|Boolean} [options.sortable=false] Options for "Q/sortable" jQuery plugin. Pass true here to disable sorting interface, or an object of custom options for Q/sortable tool. If streamName is not a String, this interface is not shown.
 *   @param {Function} [options.tabs] Function for interacting with any parent "Q/tabs" tool. Format is function (previewTool, tabsTool) { return urlOrTabKey; }
 *   @param {Object} [options.tabsOptions] Options for the tabs function
 *   @param {Boolean} [options.tabsOptions.useStreamURLs] Whether to use the stream URLs instead of Streams.key() and tab names
 *   @param {String} [options.tabsOptions.streamType] You can manually enter the type of all related streams, to be used with Streams.Stream.url()
 *   @param {Object} [options.activate] Options for activating the preview tools that are loaded inside
 *   @param {Boolean|Object} [infinitescroll=false] If true or object, enables loading more related streams on demand, by activate Q/infinitescroll tool on closest scrolling ancestor (if tool.element non scrollable). If object, set it as Q/infinitescroll params.
 *   @param {Object} [options.updateOptions] Options for onUpdate such as duration of the animation, etc.
 *   @param {Function|String} [options.renderer=null] Optional renderer for each related stream, used instead of the
 *     full Streams/preview DOM. Accepts either a compiled function or a Handlebars template string.
 *     Signature: function(stream, previewTool, callback) where callback receives a single DOM element.
 *     When Q/coverflow is co-activated on the same element, a built-in renderer is supplied automatically
 *     (producing an img or video element per stream) unless you override this option explicitly.
 *     A Handlebars template string receives: {publisherId, streamName, streamType, title, icon, url}.
 *     Note: Handlebars template renderers cannot do async icon loading; use a function renderer for that.
 *   @param {Object} [options.beforeRenderPreview] Event occurs before Streams/preview tool rendered inside related tool.
 *      If a handler returns false, the preview tool won't be added to the related list
 *   @param {Q.Event} [options.onUpdate] Event that receives parameters "data", "entering", "exiting", "updating"
 *   @param {Q.Event} [options.onRefresh] Event that occurs when the tool is completely refreshed, the "this" is the tool.
 *      Parameters are (previews, map, entering, exiting, updating).
 *      Also fired after a local composer creates a stream (own related messages skip refresh).
 */
Q.Tool.define("Streams/related", function _Streams_related_tool (options) {
	var tool = this;
	var state = this.state;
	if ((!state.publisherId || !state.streamName)
	&& (!state.stream || Q.typeOf(state.stream) !== 'Q.Streams.Stream')) {
		throw new Q.Error("Streams/related tool: missing publisherId or streamName");
	}
	if (state.sortable === true) {
		state.sortable = Q.extend({
			draggable: '.Streams_related_stream',
			droppable: '.Streams_related_stream'
		}, Q.Tool.define.options('Streams/related').sortable);
	} else if (state.sortable && typeof state.sortable !== 'object') {
		throw new Q.Error("Streams/related tool: sortable must be an object or boolean");
	}

	tool.previewElements = {};

	state.publisherId = state.publisherId || state.stream.fields.publisherId;
	state.streamName = state.streamName || state.stream.fields.name;

	if (this.element.classList.contains("Streams_related_participant")) {
		state.mode = "participant";
	} else if (state.mode === "participant" && !this.element.classList.contains("Streams_related_participant")) {
		this.element.classList.add("Streams_related_participant");
	}

	tool._normalizeRenderer();

	tool.Q.onStateChanged('relationType').set(function () {
		if (Q.isEmpty(tool.state.result)) {
			return;
		}
		Q.handle(state.onUpdate, tool, [tool.state.result, {}, tool.state.result.relatedStreams, {}]);
		tool.state.result = {};
		tool.previewElements = {};
		tool.refresh();
	}, tool);

	var pipe = new Q.Pipe(['styles', 'texts'], tool.refresh.bind(tool));
	Q.addStylesheet("{{Streams}}/css/tools/related.css", pipe.fill('styles'));
	Q.Text.get('Streams/content', function (err, text) {
		var msg = Q.firstErrorMessage(err);
		if (msg) {
			console.warn(msg);
		}
		tool.text = text;
		pipe.fill('texts')();
	});

	this.element.forEachTool('Streams/preview', function () {
		var preview = this;
		preview.Q.beforeRemove.set(function () {
			var publisherId = preview.state.publisherId;
			var streamName = preview.state.streamName;
			if (!publisherId || !streamName) {
				return;
			}
			if (Q.getObject([publisherId, streamName], tool.previewElements) === preview.element) {
				tool._forgetPreview(publisherId, streamName);
			}
		}, tool);
	}, tool);

	Q.onLayout(tool.element).set(function () {
		tool._applyInfinitescroll();
	}, tool);
},

{
	publisherId: Users.communityId,
	isCategory: true,
	relationType: null,
	realtime: false,
	infinitescroll: false,
	composerPosition: null,
	renderer: null,
	activate: {
		batchSize: {
			start: 20,
			grow: 1.5
		}
	},
	editable: true,
	closeable: true,
	creatable: {},
	relatedOptions: {
		limit: 50,
		offset: 0,
		dontFilterUsers: false
	},
	sortable: false,
	previewOptions: {},
	updateOptions: {
		duration: 300
	},
	tabs: function (previewTool, tabsTool) {
		var ps = previewTool.state;
		if (this.state.tabsOptions.useStreamURLs) {
			var streamType = this.state.previewOptions.streamType;
			if (!streamType) {
				var cached = Streams.get.cache.get([
					ps.publisherId,
					ps.streamName
				]);
				if (cached && cached.subject) {
					streamType = cached.subject.fields.type;
				}
			}
			var url = Streams.Stream.url(
				previewTool.state.publisherId,
				previewTool.state.streamName,
				streamType
			);
			if (url) {
				return url;
			}
		}
		return Streams.key(previewTool.state.publisherId, previewTool.state.streamName);
	},
	tabsOptions: {
		useStreamURLs: true,
		streamType: null
	},
	toolName: function (streamType) {
		return streamType+'/preview';
	},
	beforeRenderPreview: new Q.Event(function (tff, element) {
		if (!tff.name) {
			var found = false;
			this._container().children('.Streams_related_composer').each(function () {
				if (this !== element && this.getAttribute('data-streamType') === tff.type) {
					found = true;
					return false;
				}
			});
			return !found;
		}
		var existing = Q.getObject([tff.publisherId, tff.name], this.previewElements);
		return !existing || existing === element;
	}),
	onUpdate: new Q.Event(function () {
		this._onUpdate.apply(this, arguments);
	}),
	onRefresh: new Q.Event(function () {
		this._applyInfinitescroll();
	})
},

{
	/**
	 * Call this method to refresh the contents of the tool, requesting only
	 * what's needed and redrawing only what's needed.
	 * @method refresh
	 * @param {Function} onUpdate An optional callback to call after the update has completed.
	 *  It receives (result, entering, exiting, updating) arguments.
	 *  The child tools may still be refreshing after this. If you want to call a function
	 *  after they have all refreshed, use the tool.state.onRefresh event.
	 */
	refresh: function (onUpdate) {
		var tool = this;
		var state = tool.state;
		Streams.retainWith(tool).related.force(
			state.publisherId || Q.getObject("stream.fields.publisherId", state),
			state.streamName || Q.getObject("stream.fields.name", state),
			state.relationType,
			state.isCategory,
			state.relatedOptions,
			function (errorMessage) {
				if (errorMessage) {
					return console.warn("Streams/related refresh: " + errorMessage);
				}
				tool.relatedResult(this, onUpdate);
			}
		);
	},
	/**
	 * Process related results
	 * @method relatedResult
	 * @param {Object} result related result
	 * @param {function} onUpdate callback executed when updated
	 * @param {boolean} [partial] flag to indicate that loaded partial data. This case no need to compare streams for exiting.
	 */
	relatedResult: function (result, onUpdate, partial) {
		var tool = this;
		var state = this.state;

		if (tool.state.realtime && !tool.stream) {
			if (Q.getObject("participant.state", result.stream) !== 'participating') {
				result.stream.retain(tool);
			}
		}

		tool.stream = result.stream;

		function comparator(s1, s2) {
			return s1 && s2 && s1.fields && s2.fields
				&& s1.fields.publisherId === s2.fields.publisherId
				&& s1.fields.name === s2.fields.name;
		}
		var tsr = tool.state.result;
		var entering, exiting, updating;
		if (!Q.isEmpty(tsr)) {
			exiting = partial ? null : Q.diff(tsr.relatedStreams, result.relatedStreams, comparator);
			entering = Q.diff(result.relatedStreams, tsr.relatedStreams, comparator);
			updating = Q.diff(result.relatedStreams, entering, exiting, comparator);
		} else {
			exiting = updating = [];
			entering = result.relatedStreams;
		}
		tool.state.onUpdate.handle.apply(tool, [result, entering, exiting, updating]);
		Q.handle(onUpdate, tool, [result, entering, exiting, updating]);

		var dir = tool.state.isCategory ? 'To' : 'From';
		var eventNames = ['onRelated'+dir, 'onUnrelated'+dir, 'onUpdatedRelate'+dir];
		if (tool.state.realtime) {
			Q.each(eventNames, function (i, eventName) {
				result.stream[eventName]().set(function (msg, fields) {
					tool.applyRelationMessage(msg, fields);
				}, tool);
			});
		} else {
			Q.each(eventNames, function (i, eventName) {
				result.stream[eventName]().remove(tool);
			});
		}
		tool.state.result = Q.extend(tool.state.result, 2, result, 2);
		tool.state.lastMessageOrdinal = result.stream.fields.messageCount;
	},
	/**
	 * Request part of related data and add previews
	 * @method loadMore
	 * @param {number} offset
	 * @param {function} onUpdate callback executed when updated
	 */
	loadMore: function (offset, onUpdate) {
		var tool = this;
		var state = tool.state;
		var limit = Q.getObject("relatedOptions.limit", state);
		if (!limit) {
			throw new Q.Error("Streams/related/loadMore: limit undefined, no sense to use loadMore, because all items loaded");
		}

		Streams.retainWith(tool).related(
			state.publisherId || Q.getObject("stream.fields.publisherId", state),
			state.streamName || Q.getObject("stream.fields.name", state),
			state.relationType,
			state.isCategory,
			Q.extend({}, state.relatedOptions, { limit: limit, offset: offset }),
			function (errorMessage) {
				if (errorMessage) {
					return console.warn("Streams/related refresh: " + errorMessage);
				}
				tool.relatedResult(this, onUpdate, true);
			}
		);
	},
	/**
	 * Apply a realtime related/unrelated/updatedRelate message by patching
	 * state.result and feeding entering/exiting/updating into onUpdate.
	 * Falls back to refresh when the message cannot describe a local diff.
	 * @method applyRelationMessage
	 * @param {Object} msg Streams message
	 * @param {Object} fields Relation instructions from the message
	 */
	applyRelationMessage: function (msg, fields) {
		var tool = this;
		var state = tool.state;

		if (!fields || fields.type !== state.relationType) {
			return;
		}

		Streams.related.cache.removeEach([state.publisherId, state.streamName]);

		var farPublisherId = state.isCategory ? fields.fromPublisherId : fields.toPublisherId;
		var farStreamName = state.isCategory ? fields.fromStreamName : fields.toStreamName;
		var existingPreview = farPublisherId && farStreamName
			? Q.getObject([farPublisherId, farStreamName], tool.previewElements)
			: null;

		// Own-client: skip only related* when preview already exists (composer
		// onCreate). Do NOT skip unrelated/updatedRelate — otherwise a socket
		// message can arrive before removeRelation's HTTP callback and leave a
		// stale previewElements entry that blocks the next relatedTo enter.
		if (Users.loggedInUser
		&& msg.byUserId == Users.loggedInUser.id
		&& msg.byClientId
		&& msg.byClientId === Q.clientId()
		&& existingPreview
		&& /^Streams\/related(To|From)$/.test(msg.type)) {
			state.lastMessageOrdinal = msg.ordinal;
			return;
		}

		if (Q.isEmpty(state.result)
		|| (/^Streams\/updatedRelate(To|From)$/.test(msg.type) && fields.mode === 'shift')
		|| !farPublisherId || !farStreamName) {
			return tool._refreshFromMessage(msg);
		}

		var result = state.result;
		var key = Streams.key(farPublisherId, farStreamName);
		var entering = [];
		var exiting = [];
		var updating = [];
		var relationWeight = (fields.weight != null) ? fields.weight : msg.weight;

		function _finish() {
			tool._finishRelationPatch(result, entering, exiting, updating, msg.ordinal);
		}

		if (/^Streams\/related(To|From)$/.test(msg.type)) {
			var limit = Q.getObject('relatedOptions.limit', state);
			if (limit && tool._relationCount(result) >= limit && !result.relatedStreams[key]) {
				return tool._refreshFromMessage(msg);
			}
			if (result.relatedStreams[key] && existingPreview) {
				state.lastMessageOrdinal = msg.ordinal;
				return;
			}
			// Stale previewElements after unrelated raced ahead of removeRelation
			if (existingPreview && !result.relatedStreams[key]) {
				Q.removeElement(existingPreview, true);
				tool._forgetPreview(farPublisherId, farStreamName);
				existingPreview = null;
			}
			if (result.relatedStreams[key] && !existingPreview) {
				tool._ensureRelation(result, result.relatedStreams[key], farPublisherId, farStreamName, fields, relationWeight);
				entering.push(result.relatedStreams[key]);
				_finish();
				return;
			}
			Streams.get(farPublisherId, farStreamName, function (err) {
				var stream = this;
				if (err || !Streams.isStream(stream)) {
					return tool.refresh();
				}
				result.relatedStreams[key] = stream;
				tool._ensureRelation(result, stream, farPublisherId, farStreamName, fields, relationWeight);
				entering.push(stream);
				_finish();
			});
			return;
		}

		if (/^Streams\/unrelated(To|From)$/.test(msg.type)) {
			var removed = result.relatedStreams[key];
			if (!removed) {
				state.lastMessageOrdinal = msg.ordinal;
				return;
			}
			delete result.relatedStreams[key];
			tool._removeRelations(result.relations || [], farPublisherId, farStreamName, fields.type);
			exiting.push(removed);
			_finish();
			return;
		}

		if (/^Streams\/updatedRelate(To|From)$/.test(msg.type)) {
			var existing = result.relatedStreams[key];
			if (!existing) {
				return tool._refreshFromMessage(msg);
			}
			var rel = tool._spliceRelation(result.relations, farPublisherId, farStreamName, fields.type);
			if (!rel) {
				return tool._refreshFromMessage(msg);
			}
			rel.weight = relationWeight;
			tool._insertRelation(result.relations, rel);
			updating.push(existing);
			_finish();
			return;
		}

		tool._refreshFromMessage(msg);
	},

	/**
	 * Animate a related preview out, then invoke callback (e.g. removeElement).
	 * @method _animateRelatedExit
	 * @private
	 * @param {HTMLElement} element
	 * @param {Function} done
	 */
	_animateRelatedExit: function (element, done) {
		var duration = Q.getObject('updateOptions.duration', this.state) || 300;
		if (!element || !element.setAttribute) {
			return Q.handle(done);
		}
		var finished = false;
		function _done() {
			if (finished) {
				return;
			}
			finished = true;
			element.removeEventListener('transitionend', _onEnd);
			Q.handle(done);
		}
		function _onEnd(e) {
			if (e.target === element) {
				_done();
			}
		}
		element.setAttribute('data-streams-related', 'exiting');
		element.addEventListener('transitionend', _onEnd);
		setTimeout(_done, duration + 50);
	},

	/**
	 * Mark a newly placed preview so CSS can animate it in.
	 * @method _animateRelatedEnter
	 * @private
	 * @param {HTMLElement} element
	 */
	_animateRelatedEnter: function (element) {
		if (!element || !element.setAttribute) {
			return;
		}
		if (element.getAttribute('data-streams-related') !== 'entering') {
			element.setAttribute('data-streams-related', 'entering');
		}
		requestAnimationFrame(function () {
			requestAnimationFrame(function () {
				element.removeAttribute('data-streams-related');
			});
		});
	},

	/**
	 * Some time need to remove relation when user doesn't participated to stream (hence doesn't get unrelatedTo message).
	 * @method removeRelation
	 * @param {String } publisherId
	 * @param {String} streamName
	 */
	removeRelation: function (publisherId, streamName) {
		var result = this.state.result;
		var previewEl = Q.getObject([publisherId, streamName], this.previewElements);
		if (!previewEl) {
			return;
		}
		Q.Tool.remove(previewEl, true, true);
		if (result) {
			delete result.relatedStreams[Streams.key(publisherId, streamName)];
			this._removeRelations(result.relations || [], publisherId, streamName);
		}
	},
	/**
	 * You don't normally have to call this method, since it's called automatically.
	 * Sets up an element for the stream with the tag and toolName provided to the
	 * Streams/related tool. Also populates "publisherId", "streamName" and "related"
	 * options for the tool.
	 * @method elementForStream
	 * @param {String } publisherId
	 * @param {String} streamName
	 * @param {String} streamType
	 * @param {Number} weight The weight of the relation
	 * @param {Object} [previewOptions]
	 *  Options for the Streams/preview tool
	 * @param {Object} [specificOptions]
	 *  Options for the $streamType/preview tool
	 * @return {HTMLElement} An element ready for Q.activate
	 */
	elementForStream: function (
		publisherId, streamName, streamType, weight,
		previewOptions, specificOptions
	) {
		var tool = this;
		var state = this.state;
		var o = Q.extend({
			publisherId: publisherId,
			streamName: streamName,
			related: {
				publisherId: state.publisherId,
				streamName: state.streamName,
				type: state.relationType,
				weight: weight
			},
			editable: state.editable,
			closeable: state.closeable
		}, previewOptions);
		var f = state.toolName;
		if (typeof f === 'string') {
			f = Q.getObject(f) || f;
		}
		var toolName = (typeof f === 'function') ? f(streamType, o) : f;
		var toolNames = ['Streams/preview', toolName];
		var toolOptions = [o, specificOptions || {}];

		if (state.mode === "participant" && state.closeable && publisherId && streamName) {
			toolNames.push("Q/badge");
			toolOptions.push({
				tr: {
					size: "24px",
					right: "-10px",
					top: "-5px",
					className: "Streams_preview_close",
					display: 'block',
					onClick: function (e) {
						e.preventDefault();
						e.stopPropagation();

						var $element = $(this).closest(".Streams_preview_tool");

						$element.addClass('Q_working');
						Q.confirm(tool.text.participating.AreYouSureRemoveParticipant, function (res) {
							if (!res) {
								return $element.removeClass('Q_working');
							}

							Streams.unrelate(state.publisherId, state.streamName, state.relationType, publisherId, streamName, function (err) {
								$element.removeClass('Q_working');
								if (err) {
									return console.warn(err);
								}
								tool.removeRelation(publisherId, streamName);
							});
						}, {title: tool.text.participating.RemoveParticipant});

						return false;
					}
				}
			});
		}

		var e = Q.Tool.setUpElement(
			state.tag || 'div',
			toolNames,
			toolOptions,
			null, this.prefix
		);
		e.setAttribute('data-publisherId', publisherId);
		e.setAttribute('data-streamName', streamName);
		e.setAttribute('data-streamType', streamType);
		e.setAttribute('data-weight', weight);
		return e;
	},

	/**
	 * You don't normally have to call this method, since it's called automatically.
	 * It integrates the tool with a Q/tabs tool on the same element or a parent element,
	 * turning each Streams/preview of a related stream into a tab.
	 * @method integrateWithTabs
	 * @param elements
	 *  The elements of the tools representing the related streams
	 */
	integrateWithTabs: function (elements, skipRefresh) {
		var tool = this;
		var state = tool.state;
		if (typeof state.tabs === 'string') {
			state.tabs = Q.getObject(state.tabs);
			if (typeof state.tabs !== 'function') {
				throw new Q.Error("Q/related tool: state.tabs does not refer to a function");
			}
		}
		var t = tool;
		if (!tool.tabs) {
			do {
				tool.tabs = t.sibling('Q/tabs');
				if (tool.tabs) {
					break;
				}
			} while (t = t.parent());
		}
		if (!tool.tabs) {
			return;
		}
		var tabs = tool.tabs;
		tool.$('.Streams_related_composer').addClass('Q_tabs_tab');
		Q.each(elements, function () {
			var element = this;
			element.addClass("Q_tabs_tab");
			var preview = Q.Tool.from(element, 'Streams/preview');
			preview.state.onRefresh.addOnce(function () {
				var value = state.tabs.call(tool, preview, tabs);
				element.setAttribute(value.isUrl() ? 'href' : 'data-name', value);
				if (!tabs.$tabs.is(element)) {
					tabs.$tabs = tabs.$tabs.add(element);
				}
				if (preview.state.onLoad) {
					preview.state.onLoad.addOnce(function () {
						tabs.refresh();
					});
				}
			});
			preview.state.onComposer.add(function () {
				tabs.refresh();
			});
		});
		if (!skipRefresh) {
			tabs.refresh();
		}
	},

	/**
	 * Rebuilds the Q/coverflow element set from the current previewElements map,
	 * preserving relation order. Called internally after renderer activations complete.
	 * Only relevant when state.renderer is set and Q/coverflow is co-activated.
	 * @method _updateCoverflow
	 * @private
	 */
	_updateCoverflow: function (result, enteringEntries, exiting) {
		var tool = this;
		var state = tool.state;
		var coverflow = Q.Tool.from(tool.element, 'Q/coverflow');
		if (!coverflow) {
			return;
		}

		var exitingMap = tool._exitingKeys(exiting);
		var allElements = [];
		Q.each(result.relations, function () {
			var tff = tool._farFields(this);
			if (!tff || exitingMap[Streams.key(tff.publisherId, tff.name)]) {
				return;
			}
			var previewEl = Q.getObject([tff.publisherId, tff.name], tool.previewElements);
			if (!previewEl) {
				return;
			}
			var renderedEl = null;
			for (var i = 0; i < enteringEntries.length; i++) {
				if (enteringEntries[i].fields.publisherId === tff.publisherId
				&& enteringEntries[i].fields.name === tff.name) {
					renderedEl = enteringEntries[i].renderedEl;
					break;
				}
			}
			renderedEl = renderedEl || previewEl._coverflowRenderedEl;
			if (!renderedEl) {
				return;
			}
			previewEl._coverflowRenderedEl = renderedEl;
			allElements.push(renderedEl);
		});

		coverflow.state.elements = allElements;
		if (!coverflow._covers || !coverflow._covers._sortableLifted) {
			coverflow.refresh();
		}

		var covers = coverflow._covers;
		if (state.sortable && covers && !tool._coverflowSortableApplied
		&& tool.stream && tool.stream.testWriteLevel('edit')) {
			var coverflowSortableOpts = coverflow.sortableOptions();
			var bound = tool._bindSortable(
				$(covers),
				Q.extend({}, state.sortable, {
					draggable: coverflowSortableOpts.draggable,
					droppable: coverflowSortableOpts.droppable
				}),
				function ($item, data) {
					var renderedEl = $item[0].querySelector('img, video');
					var targetRenderedEl = data.target && $(data.target).find('img, video')[0];
					if (!renderedEl || !targetRenderedEl) {
						return null;
					}
					var draggedPreviewEl = null, targetPreviewEl = null;
					Q.each(tool.previewElements, function () {
						Q.each(this, function () {
							if (this._coverflowRenderedEl === renderedEl) draggedPreviewEl = this;
							if (this._coverflowRenderedEl === targetRenderedEl) targetPreviewEl = this;
						});
					});
					if (!draggedPreviewEl || !targetPreviewEl) {
						return null;
					}
					var item = Q.Tool.from(draggedPreviewEl, 'Streams/preview');
					var target = Q.Tool.from(targetPreviewEl, 'Streams/preview');
					return (item && target) ? { item: item.state, target: target.state } : null;
				},
				function ($host) {
					if (!coverflowSortableOpts._onLift) {
						return;
					}
					var sortableState = $host.state('Q/sortable');
					sortableState.onLift.set(coverflowSortableOpts._onLift, 'Q/coverflow');
					sortableState.onDrop.set(coverflowSortableOpts._onDrop, 'Q/coverflow');
					sortableState.onIndicate.set(coverflowSortableOpts._onIndicate, 'Q/coverflow');
				}
			);
			if (bound) {
				tool._coverflowSortableApplied = true;
			}
		}

		state.onRefresh.handle.call(
			tool, [], {},
			enteringEntries.map(function (e) { return e.fields; }),
			exiting, []
		);
	},

	previewElement: function (publisherId, streamName) {
		return Q.getObject([publisherId, streamName], this.previewElements);
	},
	previewTool: function (publisherId, streamName) {
		return Q.getObject([publisherId, streamName, 'Q', 'tool'], this.previewElements);
	},

	/**
	 * @method _onUpdate
	 * @private
	 */
	_onUpdate: function (result, entering, exiting, updating) {
		entering = entering || [];
		exiting = exiting || [];
		updating = updating || [];
		this.element.style.setProperty(
			'--Streams_related_duration',
			(Q.getObject('updateOptions.duration', this.state) || 300) + 'ms'
		);
		if (typeof this.state.renderer === 'function') {
			this._updateRenderer(result, entering, exiting, updating);
		} else {
			this._updatePreviews(result, entering, exiting, updating);
		}
	},

	/**
	 * Normal preview-tool path: composers, sortable, place/activate previews.
	 * @method _updatePreviews
	 * @private
	 */
	_updatePreviews: function (result, entering, exiting, updating) {
		var tool = this;
		var state = tool.state;

		if (result.stream.testWriteLevel('relate')) {
			Q.each(state.creatable, function (streamType, params) {
				tool._addComposer(streamType, params);
			});
			if (state.sortable && result.stream.testWriteLevel('edit')) {
				tool._bindSortable($(tool.element), Q.extend({}, state.sortable), function ($item, data) {
					var item = Q.Tool.from($item[0], 'Streams/preview');
					var target = Q.Tool.from(data.target, 'Streams/preview');
					return (item && target) ? { item: item.state, target: target.state } : null;
				});
			}
		}

		Q.each(exiting, function () {
			if (!this || !this.fields) {
				return;
			}
			var publisherId = this.fields.publisherId;
			var streamName = this.fields.name;
			var element = Q.getObject([publisherId, streamName], tool.previewElements);
			if (!element) {
				return;
			}
			tool._forgetPreview(publisherId, streamName);
			tool._animateRelatedExit(element, function () {
				Q.removeElement(element, true);
			});
		});

		var exitingKeys = tool._exitingKeys(exiting);
		tool._applyUpdatingWeights(result, updating);
		Q.each(updating, function () {
			if (!this || !this.fields) {
				return;
			}
			var element = Q.getObject([this.fields.publisherId, this.fields.name], tool.previewElements);
			if (element) {
				tool._placeRelatedElement(element);
			}
		});

		var elements = [];
		Q.each(result.relations, function () {
			var tff = tool._farFields(this);
			if (!tff || exitingKeys[Streams.key(tff.publisherId, tff.name)]
			|| Q.getObject([tff.publisherId, tff.name], tool.previewElements)) {
				return;
			}
			var element = tool.elementForStream(
				tff.publisherId, tff.name, tff.type,
				this.weight, state.previewOptions, state.specificOptions
			);
			if (Q.handle(state.beforeRenderPreview, tool, [tff, element]) === false) {
				return;
			}
			elements.push(element);
			$(element).addClass('Streams_related_stream');
			tool._rememberPreview(tff.publisherId, tff.name, element);
			element.setAttribute('data-streams-related', 'entering');
			tool._placeRelatedElement(element);
			tool._animateRelatedEnter(element);
		});

		tool._activatePreviews(elements, entering, exiting, updating);
	},

	/**
	 * Renderer / coverflow path: hidden previews, lightweight rendered elements.
	 * Skips composers (same as before).
	 * @method _updateRenderer
	 * @private
	 */
	_updateRenderer: function (result, entering, exiting, updating) {
		var tool = this;
		var state = tool.state;
		var exitingPending = 0;

		function _continue() {
			var exitingKeys = tool._exitingKeys(exiting);
			tool._applyUpdatingWeights(result, updating);

			var enteringEntries = [];
			Q.each(result.relations, function () {
				var tff = tool._farFields(this);
				if (!tff || exitingKeys[Streams.key(tff.publisherId, tff.name)]
				|| Q.getObject([tff.publisherId, tff.name], tool.previewElements)) {
					return;
				}
				var element = tool.elementForStream(
					tff.publisherId, tff.name, tff.type,
					this.weight, state.previewOptions, state.specificOptions
				);
				tool.element.appendChild(element);
				tool._rememberPreview(tff.publisherId, tff.name, element);
				enteringEntries.push({ element, fields: tff, weight: this.weight });
			});

			if (!enteringEntries.length && Q.isEmpty(exiting) && Q.isEmpty(updating)) {
				return;
			}
			if (!enteringEntries.length) {
				return tool._updateCoverflow(result, enteringEntries, exiting);
			}

			Q.activate(enteringEntries.map(function (e) { return e.element; }), null, function () {
				var pending = enteringEntries.length;
				if (!pending) {
					return tool._updateCoverflow(result, enteringEntries, exiting);
				}
				function _maybeDone() {
					if (--pending) {
						return;
					}
					Q.each(enteringEntries, function () {
						if (this.renderedEl) {
							this.renderedEl.setAttribute('data-streams-related', 'entering');
						}
					});
					tool._updateCoverflow(result, enteringEntries, exiting);
					Q.each(enteringEntries, function () {
						if (this.renderedEl) {
							tool._animateRelatedEnter(this.renderedEl);
						}
					});
				}
				enteringEntries.forEach(function (entry) {
					var previewTool = Q.Tool.from(entry.element, 'Streams/preview');
					if (!previewTool) {
						return _maybeDone();
					}
					function _render(stream) {
						state.renderer(stream, previewTool, function (renderedEl) {
							entry.renderedEl = renderedEl;
							$(renderedEl).on(Q.Pointer.fastclick, function () {
								Q.handle(previewTool.state.onInvoke, previewTool, []);
							});
							_maybeDone();
						});
					}
					var cached = Q.Streams.get.cache.get([entry.fields.publisherId, entry.fields.name]);
					var stream = cached && cached.subject;
					if (stream) {
						_render(stream);
					} else {
						Q.Streams.get(entry.fields.publisherId, entry.fields.name, function (err, s) {
							if (err || !s) {
								return _maybeDone();
							}
							_render(s);
						});
					}
				});
			});
		}

		Q.each(exiting, function () {
			if (!this || !this.fields) {
				return;
			}
			var publisherId = this.fields.publisherId;
			var streamName = this.fields.name;
			var element = Q.getObject([publisherId, streamName], tool.previewElements);
			if (!element) {
				return;
			}
			tool._forgetPreview(publisherId, streamName);
			++exitingPending;
			var renderedEl = element._coverflowRenderedEl;
			if (renderedEl) {
				tool._animateRelatedExit(renderedEl, function () {
					Q.removeElement(element, true);
					if (!--exitingPending) {
						_continue();
					}
				});
			} else {
				Q.removeElement(element, true);
				if (!--exitingPending) {
					_continue();
				}
			}
		});

		if (!exitingPending) {
			_continue();
		}
	},

	_activatePreviews: function (elements, entering, exiting, updating) {
		var tool = this;
		var state = tool.state;
		var previews = [];
		var map = {};
		if (!elements.length) {
			if (tool.tabs) {
				tool.tabs.refresh();
			}
			state.onRefresh.handle.call(tool, previews, map, entering, exiting, updating);
			return;
		}
		var i = 0;
		var batchSize = state.activate.batchSize.start;
		setTimeout(function _activatePreview() {
			var elementsToActivate = [];
			var done = false;
			for (var j = 0; j < batchSize; ++j) {
				var element = elements[i++];
				if (element) {
					elementsToActivate.push(element);
				} else {
					done = true;
					break;
				}
			}
			batchSize *= state.activate.batchSize.grow;
			Q.activate(elementsToActivate, null, function (elem, tools) {
				Q.each(tools, function () {
					var index = previews.push(this) - 1;
					var publisherId = Q.getObject("preview.state.publisherId", this);
					var streamName = Q.getObject("preview.state.streamName", this);
					if (publisherId && streamName) {
						map[Streams.key(publisherId, streamName)] = index;
					}
				});
				tool.integrateWithTabs(elem, true);
				if (done) {
					if (tool.tabs) {
						tool.tabs.refresh();
					}
					state.onRefresh.handle.call(tool, previews, map, entering, exiting, updating);
					return;
				}
				setTimeout(_activatePreview, 0);
			});
		}, 0);
	},

	_normalizeRenderer: function () {
		var state = this.state;
		var names = Q.getObject(['Q', 'toolNames'], this.element) || [];
		var hasCoverflow = names.indexOf(Q.normalize('Q/coverflow')) >= 0;
		if (hasCoverflow && !state.renderer) {
			state.renderer = _coverflowRenderer;
		} else if (state.renderer === 'coverflow') {
			state.renderer = _coverflowRenderer;
		} else if (typeof state.renderer === 'string') {
			state.renderer = _compileHandlebarsRenderer(state.renderer);
		}
		if (typeof state.renderer === 'function') {
			this.element.setAttribute('data-view', 'renderer');
		}
	},

	_applyInfinitescroll: function () {
		var tool = this;
		var state = tool.state;
		if (!state.infinitescroll || tool.infinitescrollApplied) {
			return;
		}
		var $dummyElement = $("<div>").css("height", $(window).height() * 2).appendTo(tool.element);
		var scrollableElement = tool.element.scrollingParent(true, "vertical", true);
		$dummyElement.remove();
		if (!(scrollableElement instanceof HTMLElement) || scrollableElement.tagName === "HTML") {
			return;
		}
		$(scrollableElement).tool('Q/infinitescroll', {
			onInvoke: function () {
				var offset = $(">.Streams_preview_tool.Streams_related_stream:visible", tool.element).length;
				var infiniteTool = this;
				if (!isNaN(infiniteTool.state.offset) && infiniteTool.state.offset >= offset) {
					return;
				}
				infiniteTool.setLoading(true);
				infiniteTool.state.offset = offset;
				tool.loadMore(offset, function () {
					infiniteTool.setLoading(false);
				});
			}
		}, null, tool.prefix).activate(function () {
			tool.infinitescrollApplied = true;
		});
	},

	_container: function () {
		var $te = $(this.element);
		return $te.hasClass('Q_tabs_tool') ? $te.find('.Q_tabs_tabs') : $te;
	},

	_farFields: function (relation) {
		if (!relation) {
			return null;
		}
		var direction = this.state.isCategory ? relation.from : relation.to;
		return (direction && direction.fields) ? direction.fields : null;
	},

	_rememberPreview: function (publisherId, streamName, element) {
		Q.setObject([publisherId, streamName], element, this.previewElements);
		return element;
	},

	_forgetPreview: function (publisherId, streamName) {
		if (this.previewElements[publisherId]) {
			delete this.previewElements[publisherId][streamName];
			if (Q.isEmpty(this.previewElements[publisherId])) {
				delete this.previewElements[publisherId];
			}
		}
	},

	_exitingKeys: function (exiting) {
		var keys = {};
		Q.each(exiting, function () {
			if (this.fields) {
				keys[Streams.key(this.fields.publisherId, this.fields.name)] = true;
			}
		});
		return keys;
	},

	_relationMatches: function (relation, publisherId, streamName, type) {
		if (!relation) {
			return false;
		}
		var match = this.state.isCategory
			? (relation.fromPublisherId === publisherId && relation.fromStreamName === streamName)
			: (relation.toPublisherId === publisherId && relation.toStreamName === streamName);
		return match && (type == null || relation.type === type);
	},

	_relationCount: function (result) {
		var n = 0;
		Q.each(result.relatedStreams, function () { ++n; });
		return n;
	},

	_removeRelations: function (relations, publisherId, streamName, type) {
		for (var j = relations.length - 1; j >= 0; --j) {
			if (this._relationMatches(relations[j], publisherId, streamName, type)) {
				relations.splice(j, 1);
			}
		}
	},

	_spliceRelation: function (relations, publisherId, streamName, type) {
		if (!relations) {
			return null;
		}
		for (var i = 0; i < relations.length; i++) {
			if (this._relationMatches(relations[i], publisherId, streamName, type)) {
				return relations.splice(i, 1)[0];
			}
		}
		return null;
	},

	_insertRelation: function (relations, relation) {
		var ascending = Q.getObject('relatedOptions.ascending', this.state) || false;
		var rw = parseFloat(relation.weight);
		for (var i = 0; i < relations.length; i++) {
			if (ascending ? rw < parseFloat(relations[i].weight) : rw > parseFloat(relations[i].weight)) {
				relations.splice(i, 0, relation);
				return;
			}
		}
		relations.push(relation);
	},

	_ensureRelation: function (result, stream, farPublisherId, farStreamName, fields, relationWeight) {
		var state = this.state;
		var relations = result.relations || (result.relations = []);
		var existing = null;
		for (var i = 0; i < relations.length; i++) {
			if (this._relationMatches(relations[i], farPublisherId, farStreamName, fields.type)) {
				existing = relations[i];
				break;
			}
		}
		if (existing) {
			existing.weight = relationWeight;
			if (state.isCategory) {
				existing.from = stream;
				existing.to = result.stream;
			} else {
				existing.to = stream;
				existing.from = result.stream;
			}
			return;
		}
		var relation = {
			type: fields.type,
			weight: relationWeight,
			fromPublisherId: state.isCategory ? farPublisherId : state.publisherId,
			fromStreamName: state.isCategory ? farStreamName : state.streamName,
			toPublisherId: state.isCategory ? state.publisherId : farPublisherId,
			toStreamName: state.isCategory ? state.streamName : farStreamName
		};
		if (state.isCategory) {
			relation.to = result.stream;
			relation.from = stream;
		} else {
			relation.from = result.stream;
			relation.to = stream;
		}
		this._insertRelation(relations, relation);
	},

	_refreshFromMessage: function (msg) {
		this.refresh();
		this.state.lastMessageOrdinal = msg.ordinal;
	},

	_finishRelationPatch: function (result, entering, exiting, updating, ordinal) {
		this.state.result = result;
		this.state.onUpdate.handle.apply(this, [result, entering, exiting, updating]);
		this.state.lastMessageOrdinal = ordinal;
	},

	_weightFor: function (result, publisherId, streamName) {
		var tool = this;
		var w = null;
		Q.each(result.relations, function () {
			var tff = tool._farFields(this);
			if (tff && tff.publisherId === publisherId && tff.name === streamName) {
				w = this.weight;
				return false;
			}
		});
		return w;
	},

	_applyUpdatingWeights: function (result, updating) {
		var tool = this;
		Q.each(updating, function () {
			if (!this || !this.fields) {
				return;
			}
			var publisherId = this.fields.publisherId;
			var streamName = this.fields.name;
			var element = Q.getObject([publisherId, streamName], tool.previewElements);
			if (!element) {
				return;
			}
			var weight = tool._weightFor(result, publisherId, streamName);
			if (weight == null) {
				return;
			}
			Q.setObject("options.streams_preview.related.weight", weight, element);
			element.setAttribute('data-weight', weight);
			var preview = Q.Tool.from(element, 'Streams/preview');
			if (preview && preview.state.related) {
				preview.state.related.weight = weight;
			}
		});
	},

	_composerPosition: function () {
		var ascending = Q.getObject("ascending", this.state.relatedOptions) || false;
		return this.state.composerPosition || (ascending ? "last" : "first");
	},

	_repositionComposers: function () {
		var $container = this._container();
		var $composer = $container.children('.Streams_related_composer');
		var pos = this._composerPosition();
		if (pos === "first") {
			$container.prepend($composer);
		} else if (pos === "last") {
			$container.append($composer);
		}
	},

	/**
	 * Insert a preview relative to siblings by weight. Uses the direct child of
	 * the container as the anchor so wrapped previews (Places/locations) stay intact.
	 * @method _placeRelatedElement
	 * @private
	 */
	_placeRelatedElement: function (element) {
		var tool = this;
		var $container = tool._container();
		var container = $container[0];
		var ascending = Q.getObject("ascending", tool.state.relatedOptions) || false;
		var thisWeight = Q.getObject("options.streams_preview.related.weight", element);
		var closestLargerWeight = null;
		var closestLargerElement = null;

		function _placementAnchor(el) {
			var node = el && el.nodeType ? el : null;
			if (!node || !container || !container.contains(node)) {
				return null;
			}
			while (node.parentNode && node.parentNode !== container) {
				node = node.parentNode;
			}
			return (node.parentNode === container) ? node : null;
		}
		function _placeBefore(anchor, el) {
			var node = _placementAnchor(anchor);
			if (node && node !== el) {
				$(node).before(el);
			} else {
				$container.prepend(el);
			}
		}
		function _placeAfter(anchor, el) {
			var node = _placementAnchor(anchor);
			if (node && node !== el) {
				$(node).after(el);
			} else {
				$container.append(el);
			}
		}

		Q.each(tool.previewElements, function () {
			Q.each(this, function () {
				var weight = Q.getObject("options.streams_preview.related.weight", this);
				if (weight > thisWeight && (!closestLargerWeight || weight < closestLargerWeight)) {
					closestLargerWeight = weight;
					closestLargerElement = this;
				}
			});
		});

		if (closestLargerElement) {
			if (ascending) {
				_placeBefore(closestLargerElement, element);
			} else {
				_placeAfter(closestLargerElement, element);
			}
		} else {
			var $siblings = $(".Streams_related_stream", $container).filter(function () {
				return this !== element
					&& $(this).closest('.Streams_related_tool')[0] === tool.element;
			});
			if (ascending) {
				$siblings.length ? _placeAfter($siblings.last()[0], element) : $container.append(element);
			} else {
				$siblings.length ? _placeBefore($siblings.first()[0], element) : $container.prepend(element);
			}
		}

		tool._repositionComposers();
	},

	_addComposer: function (streamType, params) {
		var tool = this;
		var state = tool.state;
		var $container = tool._container();
		if (params && !Q.isPlainObject(params)) {
			params = {};
		}
		params.streamType = streamType;

		var tff = {
			publisherId: params.publisherId || state.publisherId,
			name: "",
			type: streamType,
			previewOptions: Q.extend(state.previewOptions, { creatable: params }),
			specificOptions: state.specificOptions
		};

		var element = tool.elementForStream(
			tff.publisherId, tff.name, tff.type, null, tff.previewOptions, tff.specificOptions
		).addClass('Streams_related_composer Q_contextual_inactive');

		if (Q.handle(state.beforeRenderPreview, tool, [tff, element]) === false) {
			return;
		}

		tool.element.addClass('Streams_related_hasComposers');
		if (tool.tabs) {
			element.addClass('Q_tabs_tab');
		}
		if (tool._composerPosition() === "first") {
			$container.prepend(element);
		} else {
			$container.append(element);
		}

		Q.activate(element, function () {
			var preview = Q.Tool.from(element, 'Streams/preview');
			var previewState = preview.state;
			tool.integrateWithTabs([element], true);
			previewState.beforeCreate.set(function () {
				$(this.element).addClass('Streams_related_loading')
					.removeClass('Streams_related_composer');
				previewState.beforeCreate.remove(tool);
			}, tool);
			previewState.onCreate.set(function (stream) {
				tool._onComposerCreated(stream, element, streamType, params, tff);
			}, tool);
			Q.handle(state.onComposer, tool, [preview]);
		});
	},

	_onComposerCreated: function (stream, element, streamType, params, tff) {
		var tool = this;
		var state = tool.state;
		var preview = Q.Tool.from(element, 'Streams/preview');
		var publisherId = stream.fields.publisherId;
		var streamName = stream.fields.name;
		var weight = Q.getObject('state.related.weight', preview);

		element.addClass('Streams_related_stream');
		element.setAttribute("data-streamName", streamName);
		Q.setObject("options.streams_preview.related.weight", weight, element);
		element.setAttribute('data-weight', weight);

		var existing = Q.getObject([publisherId, streamName], tool.previewElements);
		var duplicate = existing && existing !== element;
		if (!duplicate) {
			tool._rememberPreview(publisherId, streamName, element);
		}

		if (duplicate || Q.handle(state.beforeRenderPreview, tool, [Q.extend({}, tff, {name: streamName}), element]) === false) {
			var keep = duplicate ? existing : Q.getObject([publisherId, streamName], tool.previewElements);
			if (keep === element) {
				keep = null;
				tool._forgetPreview(publisherId, streamName);
			} else if (keep) {
				tool._rememberPreview(publisherId, streamName, keep);
			}
			Q.removeElement(element, true);
			tool._addComposer(streamType, params);
			tool._fireComposerRefresh(stream, keep);
			return;
		}

		tool._addComposer(streamType, params);
		tool._fireComposerRefresh(stream, element);
	},

	_fireComposerRefresh: function (stream, element) {
		var tool = this;
		setTimeout(function () {
			var previewTool = element ? Q.Tool.from(element, 'Streams/preview') : null;
			var previews = [];
			var map = {};
			if (previewTool) {
				previews.push(previewTool);
				map[Streams.key(stream.fields.publisherId, stream.fields.name)] = 0;
			}
			tool.state.onRefresh.handle.call(tool, previews, map, [stream], [], []);
		}, 0);
	},

	/**
	 * Bind Q/sortable and, on drop, update the relation weight then refresh.
	 * @method _bindSortable
	 * @private
	 * @param {jQuery} $host
	 * @param {Object} options
	 * @param {Function} resolvePreviewPair ($item, data) → {item, target} preview states
	 * @param {Function} [afterInit]
	 * @return {Boolean} false if skipped (realtime mix)
	 */
	_bindSortable: function ($host, options, resolvePreviewPair, afterInit) {
		var tool = this;
		var state = tool.state;
		if (state.realtime) {
			console.warn("Streams/related: can't mix realtime and sortable options yet");
			return false;
		}
		$host.plugin('Q/sortable', options, function () {
			if (afterInit) {
				afterInit($host);
			}
			$host.state('Q/sortable').onSuccess.set(function ($item, data) {
				if (!data.direction) {
					return;
				}
				var pair = resolvePreviewPair($item, data);
				if (!pair || !pair.item || !pair.target) {
					return;
				}
				var r = pair.item.related;
				var p = new Q.Pipe(['timeout', 'updated'], function () {
					if (state.realtime) {
						return;
					}
					Streams.related.cache.removeEach([state.publisherId, state.streamName]);
					tool.refresh();
				});
				setTimeout(p.fill('timeout'), $host.state('Q/sortable').drop.duration);
				Streams.updateRelation(
					r.publisherId, r.streamName, r.type,
					pair.item.publisherId, pair.item.streamName,
					pair.target.related.weight,
					1,
					p.fill('updated')
				);
			}, tool);
		});
		return true;
	},

	Q: {
		beforeRemove: function () {
			$(this.element).plugin('Q/sortable', 'remove');
			var covers = this.element.querySelector('.Q_coverflow_covers');
			if (covers) {
				$(covers).plugin('Q/sortable', 'remove');
			}
			this._coverflowSortableApplied = false;
		}
	}
});

})(Q, Q.jQuery);
