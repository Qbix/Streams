(function (Q, $) {

/**
 * @module Streams-tools
 */

var Users = Q.Users;
var Streams = Q.Streams;

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
 */
Q.Tool.define("Streams/related", function _Streams_related_tool (options) {
	var tool = this;
	var state = this.state;
	if ((!state.publisherId || !state.streamName)
	&& (!state.stream || Q.typeOf(state.stream) !== 'Q.Streams.Stream')) {
		throw new Q.Error("Streams/related tool: missing publisherId or streamName");
	}
	if (!state.relationType) {
		// throw new Q.Error("Streams/related tool: missing relationType");
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

	// ---- coverflow detection ------------------------------------------------
	// If Q/coverflow is co-activated on the same element, switch to renderer mode.
	// The renderer can be overridden explicitly via state.renderer; if not, the
	// built-in coverflow renderer is used (img/video per stream, async icon load).
	var coverflowToolName = Q.normalize('Q/coverflow'); // → 'Q_coverflow'
	var hasCoverflow = !!(tool.element.Q
		&& tool.element.Q.toolNames
		&& tool.element.Q.toolNames.indexOf(coverflowToolName) >= 0);

	if (hasCoverflow && !state.renderer) {
		state.renderer = 'coverflow'; // resolved to built-in function below
	}

	// Normalise renderer option:
	//   'coverflow'      → built-in async function (img or video, uses preview.icon())
	//   other string     → compiled as Handlebars template (static fields only)
	//   function         → used as-is: function(stream, previewTool, callback)
	//   null / undefined → normal preview-tool path, no renderer used
	if (state.renderer === 'coverflow') {
		state.renderer = function _coverflowRenderer(stream, previewTool, callback) {
			var type = stream.fields.type || '';
			var isVideo = (type.indexOf('video') >= 0);
			var el;

			if (isVideo) {
				el = document.createElement('video');
				el.setAttribute('playsinline', '');
				el.setAttribute('muted', '');
				el.setAttribute('loop', '');
				el.setAttribute('autoplay', '');
				var attrs = {};
				try { attrs = JSON.parse(stream.fields.attributes || '{}'); } catch(e) {}
				if (attrs.url) { el.src = attrs.url; }
			} else {
				el = document.createElement('img');
			}

			el.setAttribute('title', stream.fields.title || '');
			el.setAttribute('alt',   stream.fields.title || '');

			if (!isVideo) {
				previewTool.icon(el, function () {
					callback(el);
				});
			} else {
				callback(el);
			}
		};
	} else if (typeof state.renderer === 'string') {
		var _compiled = Handlebars.compile(state.renderer);
		state.renderer = function _handlebarsRenderer(stream, previewTool, callback) {
			var html = _compiled({
				publisherId: stream.fields.publisherId,
				streamName:  stream.fields.name,
				streamType:  stream.fields.type,
				title:       stream.fields.title,
				icon:        Q.Streams.iconUrl(stream.fields.icon, 200),
				url:         Q.Streams.Stream.url(
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
	// If state.renderer is already a function, use it as-is.

	tool.Q.onStateChanged('relationType').set(function () {
		if (Q.isEmpty(tool.state.result)) {
			return;
		}

		// remove all old previews and clear cache
		Q.handle(state.onUpdate, tool, [tool.state.result, {}, tool.state.result.relatedStreams, {}]);
		tool.state.result = {};
		tool.previewElements = {};
		tool.refresh();
	}, tool);

	var pipe = new Q.Pipe(['styles', 'texts'], tool.refresh.bind(tool));

	// render the tool
	Q.addStylesheet("{{Streams}}/css/tools/related.css", pipe.fill('styles'));
	Q.Text.get('Streams/content', function (err, text) {
		var msg = Q.firstErrorMessage(err);
		if (msg) {
			console.warn(msg);
		}

		tool.text = text;
		pipe.fill('texts')();
	});

	Q.ensure('IntersectionObserver', function () {
		tool.intersectionObserver = new IntersectionObserver(function (entries) {
			entries.forEach(function (entry) {
				if (entry.intersectionRatio === 0) {
					return;
				}

				if (entry.target === tool.element) {
					if (!state.infinitescroll || tool.infinitescrollApplied) {
						return;
					}

					var $dummyElement = $("<div>").css("height", $(window).height() * 2).appendTo(tool.element);
					var scrollableElement = tool.element.scrollingParent(true, "vertical", true);
					$dummyElement.remove();
					if (!(scrollableElement instanceof HTMLElement) || scrollableElement.tagName === "HTML") {
						return console.warn("Streams/related: scrollingParent for infinitescroll not found");
					}

					$(scrollableElement).tool('Q/infinitescroll', {
						onInvoke: function () {
							var offset = $(">.Streams_preview_tool.Streams_related_stream:visible", tool.element).length;
							var infiniteTool = this;

							// skip duplicated (same offsets) requests
							if (!isNaN(infiniteTool.state.offset) && infiniteTool.state.offset >= offset) {
								return;
							}

							infiniteTool.setLoading(true);
							infiniteTool.state.offset = offset;
							tool.loadMore(offset, function () {
								infiniteTool.setLoading(false);
							});
						}
					}, null, this.prefix).activate(function () {
						tool.infinitescrollApplied = true;
					});
				}
			});
		}, {
			root: tool.element.parentElement
		});
		// detect when tool element become visible
		tool.intersectionObserver.observe(tool.element);
	});

	// observe dom elements for mutation
	tool.mutationObserver = new MutationObserver(function (mutations) {
		mutations.forEach(function(mutation) {
			if (mutation.type !== 'childList' || Q.isEmpty(mutation.removedNodes)) {
				return;
			}

			mutation.removedNodes.forEach(function(removedElement) {
				var publisherId = Q.getObject("options.streams_preview.publisherId", removedElement);
				var streamName = Q.getObject("options.streams_preview.streamName", removedElement);
				if (!publisherId || !streamName) {
					return;
				}

				if (Q.getObject([publisherId, streamName], tool.previewElements)) {
					delete tool.previewElements[publisherId][streamName];
				}
				if (Q.isEmpty(tool.previewElements[publisherId])) {
					delete tool.previewElements[publisherId];
				}
			});
		});
	});
	tool.mutationObserver.observe(tool.element, {childList: true});
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
	beforeRenderPreview: new Q.Event(function (tff) {
		var alreadyExists = false;
		$(".Streams_preview_tool" + (tff.name ? ":not(.Streams_preview_composer)" : ""), this.element).each(function () {
			var publisherId = this.getAttribute("data-publisherId");
			var streamName = this.getAttribute("data-streamName");
			var streamType = this.getAttribute("data-streamType");
			if (publisherId === tff.publisherId && streamName === tff.name && streamType === tff.type) {
				alreadyExists = true;
			}
		});
		return !alreadyExists;
	}, "Streams/related"),
	onUpdate: new Q.Event(
	function _Streams_related_onUpdate(result, entering, exiting, updating) {

		var tool = this;
		var state = tool.state;
		var $te = $(tool.element);
		var $container = $te;
		var isTabs = $te.hasClass('Q_tabs_tool');
		if (isTabs) {
			$container = $te.find('.Q_tabs_tabs');
		}

		var ascending = Q.getObject("ascending", state.relatedOptions) || false;

		// ---- renderer / coverflow path --------------------------------------
		// When state.renderer is a function (including the built-in coverflow
		// renderer resolved in the constructor), preview tools are activated but
		// kept hidden. The renderer is called per stream to produce a lightweight
		// DOM element (img, video, or anything custom) which is passed to
		// Q/coverflow. The full preview machinery (retain, realtime, onInvoke,
		// access control) remains intact on the hidden elements.
		if (typeof state.renderer === 'function') {
			var coverflow = Q.Tool.from(tool.element, 'Q/coverflow');

			// Remove exiting items from the hidden preview map
			Q.each(exiting, function () {
				var publisherId = this.fields.publisherId;
				var streamName  = this.fields.name;
				var element = Q.getObject([publisherId, streamName], tool.previewElements);
				if (element) {
					Q.removeElement(element, true);
				}
			});

			// Build a keyed lookup so we can skip exiting streams below
			var exitingKeys = {};
			Q.each(exiting, function () {
				if (this.fields) {
					exitingKeys[this.fields.publisherId + "\t" + this.fields.name] = true;
				}
			});

			// Build hidden preview elements for all entering relations
			var enteringEntries = [];
			Q.each(result.relations, function () {
				var direction = state.isCategory ? this.from : this.to;
				if (!direction) {
					return;
				}
				var tff = direction.fields;

				if (exitingKeys[tff.publisherId + "\t" + tff.name]) {
					return;
				}
				if (Q.getObject([tff.publisherId, tff.name], tool.previewElements)) {
					return;
				}

				var element = tool.elementForStream(
					tff.publisherId, tff.name, tff.type,
					this.weight,
					state.previewOptions,
					state.specificOptions
				);

				// Keep preview elements alive but hidden from the visible DOM
				element.style.display = 'none';
				tool.element.appendChild(element);
				Q.setObject([tff.publisherId, tff.name], element, tool.previewElements);
				enteringEntries.push({ element: element, fields: tff, weight: this.weight });
			});

			if (!enteringEntries.length && Q.isEmpty(exiting)) {
				return;
			}

			// Activate preview tools, then call the renderer for each stream
			var elementsToActivate = enteringEntries.map(function(e) { return e.element; });
			Q.activate(elementsToActivate, null, function () {
				var pending = enteringEntries.length;
				if (!pending) {
					return tool._updateCoverflow(result, enteringEntries, exiting);
				}

				enteringEntries.forEach(function(entry) {
					var previewTool = Q.Tool.from(entry.element, 'Streams/preview');
					if (!previewTool) {
						if (!--pending) { tool._updateCoverflow(result, enteringEntries, exiting); }
						return;
					}

					function _render(stream) {
						state.renderer(stream, previewTool, function(renderedEl) {
							entry.renderedEl = renderedEl;
							// Wire fastclick on rendered element to previewTool's onInvoke
							$(renderedEl).on(Q.Pointer.fastclick, function() {
								Q.handle(previewTool.state.onInvoke, previewTool, []);
							});
							if (!--pending) { tool._updateCoverflow(result, enteringEntries, exiting); }
						});
					}

					// Use cached stream if available, otherwise fetch
					var cached = Q.Streams.get.cache.get([entry.fields.publisherId, entry.fields.name]);
					var stream = cached && cached.subject;
					if (stream) {
						_render(stream);
					} else {
						Q.Streams.get(entry.fields.publisherId, entry.fields.name, function(err, s) {
							if (err || !s) {
								if (!--pending) { tool._updateCoverflow(result, enteringEntries, exiting); }
								return;
							}
							_render(s);
						});
					}
				});
			});

			return; // skip the normal preview-tool path entirely
		}

		// ---- normal preview-tool path ---------------------------------------

		function _placeRelatedTool (element) {
			// select closest larger weight
			var closestLargerWeight = null;
			var closestLargerElement = null;
			var elementsAmount = 0;
			var thisWeight = Q.getObject("options.streams_preview.related.weight", element);
			Q.each(tool.previewElements, function () {
				Q.each(this, function () {
					var weight = Q.getObject("options.streams_preview.related.weight", this);
					if (weight > thisWeight && (!closestLargerWeight || weight < closestLargerWeight)) {
						closestLargerWeight = weight;
						closestLargerElement = this;
					}
					elementsAmount++;
				});
			});

			if (closestLargerElement) {
				if (ascending) {
					$(closestLargerElement).before(element);
				} else {
					$(closestLargerElement).after(element);
				}
			} else {
				if (ascending) {
					if (elementsAmount <= 1) {
						$container.append(element);
					} else {
						$(".Streams_related_stream:last", $container).after(element);
					}
				} else {
					if (elementsAmount <= 1) {
						$container.prepend(element);
					} else {
						$(".Streams_related_stream:first", $container).before(element);
					}
				}
			}

			var composerPosition = state.composerPosition || (ascending ? "last" : "first");
			var $composer = $container.find('.Streams_related_composer');
				if (composerPosition === "first") {
					$container.prepend($composer);
				} else if (composerPosition === "last") {
					$container.append($composer);
				}
		}

		function addComposer(streamType, params) {
			// TODO: test whether the user can really create streams of this type
			// and otherwise do not append this element
			if (params && !Q.isPlainObject(params)) {
				params = {};
			}
			params.streamType = streamType;

			var tff = {
				publisherId: params.publisherId || tool.state.publisherId,
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

			if (state.composerPosition) {
				if (state.composerPosition === "first") {
					$container.prepend(element);
				} else if (state.composerPosition === "last") {
					$container.append(element);
				}
			} else {
				if (!ascending) {
					$container.prepend(element);
				} else {
					$container.append(element);
				}
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

					element.addClass('Streams_related_stream');

					// set data-streamName attribute to mark tool as not composer
					element.setAttribute("data-streamName", stream.fields.name);

					// set weight to preview tool and to element
					Q.setObject("options.streams_preview.related.weight", this.state.related.weight, element);
					element.setAttribute('data-weight', this.state.related.weight);

					// check if such preview already exists before place
					if (Q.handle(state.beforeRenderPreview, tool, [Q.extend({}, tff, {name: stream.fields.name}), element]) === false) {
						element.remove();
					}
					// place new preview to the valid place in the list
					_placeRelatedTool(element);

					addComposer(streamType, params);
				}, tool);

				Q.handle(state.onComposer, tool, [preview]);
			});
		}

		if (result.stream.testWriteLevel('relate')) {
			Q.each(state.creatable, addComposer);
			if (state.sortable && result.stream.testWriteLevel('edit')) {
				if (state.realtime) {
					alert("Streams/related: can't mix realtime and sortable options yet");
					return;
				}
				var sortableOptions = Q.extend({}, state.sortable);
				var $t = tool.$();
				$t.plugin('Q/sortable', sortableOptions, function () {
					$t.state('Q/sortable').onSuccess.set(function ($item, data) {
						if (!data.direction) return;
						var p = new Q.Pipe(['timeout', 'updated'], function () {
							if (state.realtime) return;
							Streams.related.cache.removeEach(
								[state.publisherId, state.streamName]
							);
							// TODO: replace with animation?
							tool.refresh();
						});
						var s = Q.Tool.from(data.target, 'Streams/preview').state;
						var i = Q.Tool.from($item[0], 'Streams/preview').state;
						var r = i.related;
						setTimeout(
							p.fill('timeout'),
							this.state('Q/sortable').drop.duration
						);
						Streams.updateRelation(
							r.publisherId,
							r.streamName,
							r.type,
							i.publisherId,
							i.streamName,
							s.related.weight,
							1,
							p.fill('updated')
						);
					}, tool);
				});
			}
		}

		// remove exiting previews
		Q.each(exiting, function (i) {
			var publisherId = this.fields.publisherId;
			var streamName = this.fields.name;
			var element = Q.getObject([publisherId, streamName], tool.previewElements);

			if (!element) {
				return;
			}

			Q.removeElement(element, true);
		});

		// Build a keyed lookup for exiting in the normal path too
		var exitingKeysNormal = {};
		Q.each(exiting, function () {
			if (this.fields) {
				exitingKeysNormal[this.fields.publisherId + "\t" + this.fields.name] = true;
			}
		});

		var elements = [];
		Q.each(result.relations, function (i) {
			var direction = state.isCategory ? this.from : this.to;
			if (!direction) {
				return;
			}

			var tff = direction.fields;

			// skip if stream exists in exiting
			if (exitingKeysNormal[tff.publisherId + "\t" + tff.name]) {
				return;
			}

			// skip if element exists
			if (Q.getObject([tff.publisherId, tff.name], tool.previewElements)) {
				return;
			}

			var element = tool.elementForStream(
				tff.publisherId,
				tff.name,
				tff.type,
				this.weight,
				state.previewOptions,
				state.specificOptions
			);

			if (Q.handle(state.beforeRenderPreview, tool, [tff, element]) === false) {
				return;
			}

			elements.push(element);
			$(element).addClass('Streams_related_stream');
			Q.setObject([tff.publisherId, tff.name], element, tool.previewElements);

			_placeRelatedTool(element);
		});

		// activate the elements one by one, asynchronously
		var previews = [];
		var map = {};
		var i=0;
		var batchSize = state.activate.batchSize.start;
		setTimeout(function _activatePreview() {
			var elementsToActivate = [];
			var _done = false;
			for (var j=0; j<batchSize; ++j) {
				var element = elements[i++];
				if (element) {
					elementsToActivate.push(element);
				} else {
					_done = true;
					break;
				}
			}
			batchSize *= state.activate.batchSize.grow;
			Q.activate(elementsToActivate, null, function (elem, tools, options) {
				Q.each(tools, function () {
					var index = previews.push(this) - 1;
					var publisherId = Q.getObject("preview.state.publisherId", this);
					var streamName = Q.getObject("preview.state.streamName", this);

					if (!publisherId || !streamName) {
						return;
					}

					var key = Streams.key(publisherId, streamName);
					map[key] = index;
				});
				tool.integrateWithTabs(elem, true);
				if (_done) {
					if (tool.tabs) {
						tool.tabs.refresh();
					}
					tool.state.onRefresh.handle.call(tool, previews, map, entering, exiting, updating);
					return;
				}
				setTimeout(_activatePreview, 0);
			});
		}, 0);
		// The elements should animate to their respective positions, like in D3.

	}, "Streams/related"),
	onRefresh: new Q.Event()
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
		var publisherId = state.publisherId || Q.getObject("stream.fields.publisherId", state);
		var streamName = state.streamName || Q.getObject("stream.fields.name", state);

		Streams.retainWith(tool).related.force(
			publisherId,
			streamName,
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

		if (tool.state.realtime && !tool.stream) {
			// join user to category stream to allow get messages
			if (Q.getObject("participant.state", result.stream) !== 'participating') {
				result.stream.retain(tool);
			}
		}

		tool.stream = result.stream;

		var entering, exiting, updating;
		entering = exiting = updating = null;
		function comparator(s1, s2, i, j) {
			return s1 && s2 && s1.fields && s2.fields
				&& s1.fields.publisherId === s2.fields.publisherId
				&& s1.fields.name === s2.fields.name;
		}
		var tsr = tool.state.result;
		if (!Q.isEmpty(tsr)) {
			if (!partial) {
				exiting = Q.diff(tsr.relatedStreams, result.relatedStreams, comparator);
			}
			entering = Q.diff(result.relatedStreams, tsr.relatedStreams, comparator);
			updating = Q.diff(result.relatedStreams, entering, exiting, comparator);
		} else {
			exiting = updating = [];
			entering = result.relatedStreams;
		}
		tool.state.onUpdate.handle.apply(tool, [result, entering, exiting, updating]);
		Q.handle(onUpdate, tool, [result, entering, exiting, updating]);

		// Now that we have the stream, we can update the event listeners again
		var dir = tool.state.isCategory ? 'To' : 'From';
		var eventNames = ['onRelated'+dir, 'onUnrelated'+dir, 'onUpdatedRelate'+dir];
		if (tool.state.realtime) {
			Q.each(eventNames, function (i, eventName) {
				result.stream[eventName]().set(function (msg, fields) {
					// TODO: REPLACE THIS WITH AN ANIMATED UPDATE BY LOOKING AT THE ARRAYS entering, exiting, updating
					var isCategory = tool.state.isCategory;
					if (fields.type !== tool.state.relationType) {
						return;
					}
					if (!Users.loggedInUser
						|| msg.byUserId != Users.loggedInUser.id
						|| msg.byClientId != Q.clientId()
						|| msg.ordinal !== tool.state.lastMessageOrdinal + 1) {
						tool.refresh();
					} else {
						tool.refresh(); // TODO: make the weights of the items in between update in the client
					}
					tool.state.lastMessageOrdinal = msg.ordinal;
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
		var publisherId = state.publisherId || Q.getObject("stream.fields.publisherId", state);
		var streamName = state.streamName || Q.getObject("stream.fields.name", state);

		var limit = Q.getObject("relatedOptions.limit", state);
		if (!limit) {
			throw new Q.Error("Streams/related/loadMore: limit undefined, no sense to use loadMore, because all items loaded");
		}

		var relatedOptions = Q.extend({}, state.relatedOptions, {
			limit: limit,
			offset: offset
		});

		Streams.retainWith(tool).related(
			publisherId,
			streamName,
			state.relationType,
			state.isCategory,
			relatedOptions,
			function (errorMessage) {
				if (errorMessage) {
					return console.warn("Streams/related refresh: " + errorMessage);
				}

				tool.relatedResult(this, onUpdate, true);
			}
		);
	},
	/**
	 * Some time need to remove relation when user doesn't participated to stream (hence doesn't get unrelatedTo message).
	 * @method removeRelation
	 * @param {String } publisherId
	 * @param {String} streamName
	 */
	removeRelation: function (publisherId, streamName) {
		var tool = this;
		var result = this.state.result;

		// In renderer mode, preview tools are hidden and may not be found by children().
		// Try previewElements directly first.
		var previewEl = Q.getObject([publisherId, streamName], tool.previewElements);
		if (previewEl) {
			var pt = Q.Tool.from(previewEl, 'Streams/preview');
			if (pt) {
				Q.Tool.remove(previewEl, true, true);
				delete result.relatedStreams[publisherId + "\t" + streamName];
				Q.each(result.relations, function (j, relation) {
					if (relation.fromPublisherId === publisherId && relation.fromStreamName === streamName) {
						result.relations.splice(j, 1);
					}
				});
				return;
			}
		}

		// Normal path: search visible child preview tools
		var previewTools = this.children("Streams/preview");
		Q.each(previewTools, function (i, previewTool) {
			previewTool = Q.getObject("streams_preview", previewTool);

			if (!previewTool) {
				return console.warn("Streams/related.removeRelation: Streams/preview tool not found");
			}

			if (previewTool.state.publisherId !== publisherId || previewTool.state.streamName !== streamName) {
				return;
			}

			Q.Tool.remove(previewTool.element, true, true);

			// delete from relatedStreams
			delete result.relatedStreams[publisherId + "\t" + streamName];

			// delete from relations
			Q.each(result.relations, function (j, relation) {
				if (relation.fromPublisherId === publisherId && relation.fromStreamName === streamName) {
					result.relations.splice(j, 1);
				}
			});
		});
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
		// we need these attributes to check if this preview tool already exists to avoid duplicated previews
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
		var id, tabs, i;
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
		tabs = tool.tabs;
		var $composer = tool.$('.Streams_related_composer');
		$composer.addClass('Q_tabs_tab');
		Q.each(elements, function (i) {
			var element = this;
			element.addClass("Q_tabs_tab");
			var preview = Q.Tool.from(element, 'Streams/preview');
			preview.state.onRefresh.addOnce(function () {
				var value = state.tabs.call(tool, preview, tabs);
				var attr = value.isUrl() ? 'href' : 'data-name';
				element.setAttribute(attr, value);
				if (!tabs.$tabs.is(element)) {
					tabs.$tabs = tabs.$tabs.add(element);
				}
				var onLoad = preview.state.onLoad;
				if (onLoad) {
					onLoad.addOnce(function () {
						// all the related tabs have loaded, process them
						tabs.refresh();
					});
				}
			});
			var key2 = preview.state.onComposer.add(function () {
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

		// Build a keyed lookup for exiting so we can skip them below.
		// exiting is an array of stream objects from Q.diff.
		var exitingMap = {};
		Q.each(exiting, function () {
			if (this.fields) {
				exitingMap[this.fields.publisherId + "\t" + this.fields.name] = true;
			}
		});
		// Walk relations in their server-defined order to preserve weight ordering
		var allElements = [];
		Q.each(result.relations, function () {
			var direction = state.isCategory ? this.from : this.to;
			if (!direction) { return; }
			var pId = direction.fields.publisherId;
			var sName = direction.fields.name;

			if (exitingMap[pId + "\t" + sName]) { return; }

			var previewEl = Q.getObject([pId, sName], tool.previewElements);
			if (!previewEl) { return; }

			// Find the rendered element: check enteringEntries first, then cached
			var renderedEl = null;
			for (var i = 0; i < enteringEntries.length; i++) {
				if (enteringEntries[i].fields.publisherId === pId
					&& enteringEntries[i].fields.name === sName) {
					renderedEl = enteringEntries[i].renderedEl;
					break;
				}
			}
			if (!renderedEl) {
				renderedEl = previewEl._coverflowRenderedEl;
			}
			if (!renderedEl) { return; }

			// Cache rendered element on hidden preview node for future partial updates
			previewEl._coverflowRenderedEl = renderedEl;
			allElements.push(renderedEl);
		});

		coverflow.state.elements = allElements;

		// Rebuild covers unless a sort drag is active — rebuilding innerHTML
		// during a drag would destroy the li the user is holding.
		if (!coverflow._covers || !coverflow._covers._sortableLifted) {
			coverflow.refresh();
		}

		var covers = coverflow._covers;

		// Apply Q/sortable to covers ul only once (first populate).
		// Subsequent calls to _updateCoverflow rebuild the li contents via
		// coverflow.refresh() above; sortable re-queries children dynamically
		// on each drag, so no re-init is needed.
		if (state.sortable && covers && !tool._coverflowSortableApplied
		&& tool.stream && tool.stream.testWriteLevel('edit')) {
			if (state.realtime) {
				console.warn("Streams/related: can't mix realtime and sortable options yet");
			} else {
				tool._coverflowSortableApplied = true;
				var $covers = $(covers);
				var coverflowTool = Q.Tool.from(tool.element, 'Q/coverflow');
				var coverflowSortableOpts = coverflowTool
					? coverflowTool.sortableOptions()
					: { draggable: 'li', droppable: 'li' };
				// Q.extend would overwrite Q.Event instances (onLift, onDrop, onIndicate)
				// from state.sortable with coverflow's versions, silently dropping any
				// user-supplied handlers. Instead: extend only non-Event properties, then
				// wire coverflow's event handlers via .set() after plugin() runs.
				var coversSortableOptions = Q.extend({}, state.sortable, {
					draggable: coverflowSortableOpts.draggable,
					droppable: coverflowSortableOpts.droppable
				});
				$covers.plugin('Q/sortable', coversSortableOptions, function () {
					// Wire coverflow event handlers after init so they coexist with
					// any user-supplied handlers from state.sortable.
					// Reuse coverflowSortableOpts from above — no need to call sortableOptions() again.
					if (coverflowTool) {
						var coversSortableState = $covers.state('Q/sortable');
						coversSortableState.onLift.set(coverflowSortableOpts._onLift, 'Q/coverflow');
						coversSortableState.onDrop.set(coverflowSortableOpts._onDrop, 'Q/coverflow');
						coversSortableState.onIndicate.set(coverflowSortableOpts._onIndicate, 'Q/coverflow');
					}
					$covers.state('Q/sortable').onSuccess.set(function ($item, data) {
						if (!data.direction) return;
						var renderedEl = $item[0].querySelector('img, video');
						if (!renderedEl) return;
						var targetRenderedEl = data.target && $(data.target).find('img, video')[0];
						if (!targetRenderedEl) return;
						var draggedPreviewEl = null, targetPreviewEl = null;
						Q.each(tool.previewElements, function () {
							Q.each(this, function () {
								if (this._coverflowRenderedEl === renderedEl) draggedPreviewEl = this;
								if (this._coverflowRenderedEl === targetRenderedEl) targetPreviewEl = this;
							});
						});
						if (!draggedPreviewEl || !targetPreviewEl) return;
						var iState = Q.Tool.from(draggedPreviewEl, 'Streams/preview').state;
						var sState = Q.Tool.from(targetPreviewEl,  'Streams/preview').state;
						if (!iState || !sState) return;
						var r = iState.related;
						var p = new Q.Pipe(['timeout', 'updated'], function () {
							Streams.related.cache.removeEach(
								[state.publisherId, state.streamName]
							);
							tool.refresh();
						});
						setTimeout(p.fill('timeout'), $covers.state('Q/sortable').drop.duration);
						Streams.updateRelation(
							r.publisherId, r.streamName, r.type,
							iState.publisherId, iState.streamName,
							sState.related.weight,
							1,
							p.fill('updated')
						);
					}, tool);
				});
			}
		}

		// Pass actual entering/exiting to onRefresh matching normal-path signature.
		var enteringFields = enteringEntries.map(function(e) { return e.fields; });
		state.onRefresh.handle.call(tool, [], {}, enteringFields, exiting, []);
	},

	previewElement: function (publisherId, streamName) {
		return Q.getObject([publisherId, streamName], this.previewElements);
	},
	previewTool: function (publisherId, streamName) {
		return Q.getObject([publisherId, streamName, 'Q', 'tool'], this.previewElements);
	},
	Q: {
		beforeRemove: function () {
			// Remove sortable from the tool element (normal mode)
			$(this.element).plugin('Q/sortable', 'remove');
			// Remove sortable from coverflow's ul if it was applied there (renderer mode)
			var covers = this.element.querySelector('.Q_coverflow_covers');
			if (covers) {
				$(covers).plugin('Q/sortable', 'remove');
			}
			this._coverflowSortableApplied = false;
			this.state.onUpdate.remove("Streams/related");
			if (this.mutationObserver) {
				this.mutationObserver.disconnect();
			}
			if (this.intersectionObserver) {
				this.intersectionObserver.disconnect();
			}
		}
	}
});

})(Q, Q.jQuery);