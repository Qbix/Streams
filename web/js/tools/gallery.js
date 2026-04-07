(function (Q, $, window, undefined) {

var Users = Q.Users;
var Streams = Q.Streams;

/**
 * @module Streams-tools
 */

/**
 * Displays a gallery of related images, backed by Q/gallery.
 * Allows editing of per-image params if user has relations write access.
 * @class Streams/gallery
 * @constructor
 * @param {Object} [options]
 */
Q.Tool.define("Streams/gallery", function (options) {
	var tool = this;
	var state = tool.state;

	if (!Users.loggedInUser) {
		throw new Q.Error("Streams/gallery: You are not logged in.");
	}
	if ((!state.publisherId || !state.streamName)
		&& (!state.stream || Q.typeOf(state.stream) !== 'Streams.Stream')
		&& Q.isEmpty(state.streams)) {
		throw new Q.Error("Streams/gallery: missing publisherId or streamName");
	}

	tool.refresh();

}, {
	// defaults
	publisherId: null,
	streamName: null,
	relationType: "Streams/images",
	streams: [],
	params: {
		transition: { duration: 1000, ease: "smooth", type: "crossfade" },
		interval:   { duration: 3000, ease: "smooth", type: "" },
		autoplay:   true,
		loop:       true
	},
	images: {
		size: 800,
		skipCaption: false
	},
	related: {
		forceUpdate: false,
		options: {}
	}
}, {
	refresh: function () {
		var tool = this, state = tool.state;

		if (!Q.isEmpty(state.streams)) {
			return tool.createGallery(state.streams);
		}

		Streams.get(state.publisherId, state.streamName).then(function (stream) {
			var relatedMethod = state.related.forceUpdate ? Streams.related.force : Streams.related;
			state.related.forceUpdate = false;
			relatedMethod(state.publisherId, state.streamName, state.relationType, true, state.related.options, function (err) {
				if (err) {
					return console.warn(err);
				}

				let self = this;
				let galleryOptions = {};

				if (stream.testWriteLevel("relations")) {
					galleryOptions.onInvoke = new Q.Event(function ($img) {
						Q.each(self.relatedStreams, function (_, imgStream) {
							if ($img.prop("src") !== imgStream.iconUrl(state.images.size)) {
								return;
							}

							tool.openImageEditor(imgStream);
						});
					});
				}

				tool.createGallery(this.relatedStreams, galleryOptions);
			});
		});
	},
	createGallery: function (streams, options = {}) {
		let tool = this;
		let $toolElement = $(this.element);
		let state = this.state;

		let keys = [];
		if (Array.isArray(streams)) {
			keys = streams.map((_, index) => String(index));
		} else if (typeof streams === 'object' && streams !== null) {
			keys = Object.keys(streams);
		} else {
			throw new Error('streams must be array or object');
		}

		let pipe = new Q.Pipe(keys, function () {
			// clear element
			$toolElement.plugin("Q/gallery", "remove");
			$toolElement.empty();

			// mount Q/gallery
			$toolElement.plugin("Q/gallery", Q.extend(options, 2, state.params));
		});

		options.images = [];
		Q.each(streams, function _processStream (key, imgStream) {
			if (!Q.Streams.isStream(imgStream)) {
				const publisherId = Q.getObject("publisherId", imgStream);
				const streamName = Q.getObject("streamName", imgStream);

				publisherId && streamName && Streams.get(publisherId, streamName, function (err) {
					if (err) {
						return;
					}

					_processStream(key, this);
				});

				return;
			}

			let overrides = imgStream.getAttribute(tool.name) || {};
			options.images.push(Q.extend({}, 2, {
				src: imgStream.iconUrl(state.images.size),
				caption: state.images.skipCaption ? "" : imgStream.fields.title || ""
			}, 2, overrides));

			pipe.fill(String(key))();
		});
	},
	openImageEditor: function (imageStream) {
		var tool = this;
		var overrides = imageStream.getAttribute(tool.name) || {};
		var intervalVal = (overrides.interval && overrides.interval.duration) 
			|| tool.state.params.interval.duration;

		var content = Q.element("div", {"class": "Q_gallery_image_editor"}, [
			Q.element("h3", {}, [tool.text.gallery.EditImageTitle]),
			Q.element("label", {}, [
				tool.text.gallery.IntervalLabel,
				Q.element("input", {
					type: "number",
					name: "interval",
					value: intervalVal,
					placeholder: tool.text.gallery.IntervalPlaceholder
				})
			]),
			Q.element("p", {}, [tool.text.gallery.KenburnsInstruction]),
			Q.element("div", {"class": "Q_gallery_kenburns_start"}),
			Q.element("div", {"class": "Q_gallery_kenburns_end"})
		]);

		var startDiv = content.querySelector(".Q_gallery_kenburns_start");
		var endDiv   = content.querySelector(".Q_gallery_kenburns_end");
		var attributes = imageStream.getAttribute("streams_gallery");
		var defaultSel = {left: 0, top: 0, width: 1, height: 1};

		var startImg = Q.element("img", {src: imageStream.iconUrl(tool.state.images.size), class: 'Q_no_lazyload'});
		var endImg   = Q.element("img", {src: imageStream.iconUrl(tool.state.images.size), class: 'Q_no_lazyload'});
		startDiv.appendChild(startImg);
		endDiv.appendChild(endImg);

		var fromSel = Q.getObject("interval.from", attributes) || Q.getObject("state.params.interval.from", tool) || defaultSel;
		var fromScale = 1/fromSel.width;
		var fromX = fromSel.left * fromScale + 0.5;
		var fromY = fromSel.top * fromScale + 0.5;

		var toSel = Q.getObject("interval.to", attributes) || Q.getObject("state.params.interval.to", tool) || defaultSel;
		var toScale = 1/toSel.width;
		var toX = toSel.left * toScale + 0.5;
		var toY = toSel.top * toScale + 0.5;

		$(startImg).plugin("Q/viewport", {
			maxScale: 5,
			initial: {
				x: fromX,
				y: fromY,
				scale: fromScale
			},
			onUpdate: new Q.Event(function (sel) {
				fromSel = sel;
			})
		});
		$(endImg).plugin("Q/viewport", {
			maxScale: 5,
			initial: {
				x: toX,
				y: toY,
				scale: toScale
			},
			onUpdate: new Q.Event(function (sel) {
				toSel = sel;
			})
		});

		Q.Dialogs.push({
			title: tool.text.gallery.DialogTitle,
			content: content,
			apply: true,
			onClose: function () {
				var intervalInput = content.querySelector("input[name=interval]");
				var interval = parseInt(intervalInput.value, 10);

				if (isNaN(interval) || interval <= 0) {
					alert(tool.text.errors.AmountInvalid);
					return;
				}

				var newOverrides = {
					interval: {
						type: "kenburns",
						duration: interval,
						from: fromSel,
						to: toSel
					}
				};

				imageStream.setAttribute(tool.name, newOverrides);
				imageStream.save({
					onSave: function (err) {
						if (err) {
							console.warn("Failed to save image params:", err);
						} else {
							tool.state.related.forceUpdate = true;
							tool.refresh();
						}
					}
				});
			}
		});
	}
});

})(Q, Q.jQuery, window);