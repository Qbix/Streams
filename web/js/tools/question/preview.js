(function (Q, $, window, undefined) {

/**
 * Streams/question/preview tool.
 * Renders a tool to preview Streams/question stream
 * @class Streams/question/preview
 * @constructor
 * @param {Object} [options] options to pass besides the ones to Streams/preview tool
 * @param {Q.Event} [options.onInvoke] occur onclick tool element
 */
Q.Tool.define("Streams/question/preview", ["Streams/preview"], function _Streams_question_preview (options, preview) {
	var tool = this;
	var $toolElement = $(tool.element);
	var state = this.state;
	tool.preview = preview;

	Q.addStylesheet('{{Streams}}/css/tools/previews.css', { slotName: 'Streams' });

	preview.state.editable = ["icon"];
	Q.Text.get('Streams/content', function (err, text) {
		var msg = Q.firstErrorMessage(err);
		if (msg) {
			return console.warn(msg);
		}

		tool.text = text.questions;
		preview.state.onRefresh.add(tool.refresh.bind(tool));
		preview.state.creatable.preprocess = tool.composer.bind(tool);
	});

	if (preview.state.streamName) {
		Q.Streams.get(preview.state.publisherId, preview.state.streamName, function () {
			var stream = this;

			if (stream.testWriteLevel('edit')) {
				preview.state.actions = {
					actions: {
						"edit": tool.edit.bind(tool),
						"remove": function () {
							Q.confirm(tool.text.AreYouSure, function (result) {
								if (!result) {
									return;
								}

								tool.preview.delete();
							});
						}
					}
				};
			}

			$toolElement.off([Q.Pointer.fastclick, "Streams_question_preview"])
			.on([Q.Pointer.fastclick, "Streams_question_preview"], function () {
				Q.handle(state.onInvoke, tool, [stream]);
			});
		});
	}

},

{
	onInvoke: new Q.Event()
},

{
	refresh: function (stream) {
		var tool = this;
		tool.stream = stream;
		var publisherId = stream.fields.publisherId;
		var streamName = stream.fields.name;
		var $toolElement = $(tool.element);
		var loggedInUserId = Q.Users.loggedInUserId();

		// retain with stream
		Q.Streams.retainWith(tool).get(publisherId, streamName);

		$toolElement.tool("Streams/default/preview").activate(function () {
			var $previewContents = $(".Streams_preview_contents", tool.element);
			var content = stream.fields.content;
			$("<div class='Streams_question_subtitle'>")
				.appendTo($previewContents)
				.tool("Streams/inplace", {
					stream: stream,
					field: "content",
					editable: false,
					inplaceType: "textarea",
					inplace: {
						placeholder: tool.text.ContentPlaceholder,
						selectOnEdit: false
					}
				}).activate();

			Q.Tool.from(this.element, "Streams/default/preview").state.onInvoke = null;

			tool.$answersRelated = $("<div>").addClass('Streams_related_answers').insertAfter($toolElement);
			tool.$answersRelated.attr("data-hideUntilAnswered", tool.stream.getAttribute("hideUntilAnswered"));
			tool.$answersRelated.tool("Streams/related", {
				publisherId: publisherId,
				streamName: streamName,
				relationType: "Streams/answers",
				isCategory: true,
				relatedOptions: {
					ascending: true,
					dontFilterUsers: true
				},
				previewOptions: {
					closeable: false
				},
				realtime: true,
				sortable: false
			}, 'Streams_related_answers', tool.prefix).activate();

			tool.$answersRelated[0].forEachTool("Streams/answer/preview", function () {
				var answerTool = this;

				this.state.onRefresh.add(function () {
					var answerType = answerTool.stream.getAttribute("type");
					var answerPublisherId = answerTool.stream.fields.publisherId;
					var answerStreamName = answerTool.stream.fields.name;
					var reqOptions = {
						publisherId: answerPublisherId,
						streamName: answerStreamName,
						type: answerType
					};
					var radioToRevert;
					var _reqCallback = function (err, response) {
						var $this = this;
						var msg = Q.firstErrorMessage(err) || Q.firstErrorMessage(response && response.errors);
						if (msg) {
							if (["option", "option.exclusive"].includes(answerType)) {
								$this.prop("checked", !$this.prop("checked"));
								radioToRevert instanceof $ && radioToRevert.prop("checked", !radioToRevert.prop("checked"));
							} else if (answerType === "text") {
								Q.Streams.Participant.get(answerPublisherId, answerStreamName, loggedInUserId,function (err, participant) {
									var msg = Q.firstErrorMessage(err);
									if (msg) {
										return console.warn(msg);
									}

									participant && $this.val(participant.getExtra("content"));
								});
							}
							return msg !== "return" && Q.alert(msg);
						}

						$(answerTool.element).attr("data-participating", !!response.slots.content);

						answerTool.updateContent(loggedInUserId, response.slots.content);

						var answerTools = tool.children('Streams/answer/preview');
						for (var k in children) {
							var answerTool = answerTools[k];
							answerTool.stream.refresh(function (err) {
								if (err) {
									return;
								}
								answerTool.stream = this;
								answerTool.setParticipants();
							}, {messages: true, unlessSocket: true, evenIfNotRetained: true});
						}
					};

					$("input[type=radio],input[type=checkbox]", answerTool.element).on('change', function () {
						var $this = $(this);
						radioToRevert = null;

						$("input[type=radio],input[type=checkbox]", tool.$answersRelated).not($this).each(function () {
							var $_this = $(this);

							if (!$_this.prop("checked")) {
								return;
							}

							if ($_this.prop("type") === "radio" && $this.prop("type") === "radio") {
								radioToRevert = $_this;
								$_this.prop("checked", false);
							}
						});

						var _req = function () {
							Q.req('Streams/answer', ["content"], _reqCallback.bind($this), {
								method: 'put',
								fields: Q.extend(reqOptions, {
									content: $this.prop("checked") ? $this.val() : ""
								})
							});
						};

						if (Q.Users.loggedInUser) {
							_req();
						} else {
							Q.Users.login({
								onSuccess: { // override default handler
									Users: _req
								}
							});
						}

					});

					$("form", answerTool.element).on('submit', function () {
						var $text = $("input[type=text]", answerTool.element);
						if (!$text.length) {
							console.warn("text element not found");
							return false;
						}

						Q.req('Streams/answer', ["content"], _reqCallback.bind($text), {
							method: 'put',
							fields: Q.extend(reqOptions, {
								content: $text.val()
							})
						});
						return false;
					});
				}, this);
			}, tool);
		});

		// on create question call edit immediately
		tool.preview.state.onNewStreamPreview.add(tool.edit.bind(tool), tool);
	},

	/**
	 * Start composer dialog
	 * @method composer
	 * @param {function} callback Need to call this function to start create stream process
	 */
	composer: function (callback) {
		var tool = this;

		Q.prompt(null, function (value) {
			if (!value) {
				return;
			}

			Q.handle(callback, tool, [{
				title: value,
				dontSubscribe: true
			}]);
		}, {
			title: tool.text.NewQuestion
		});
	},
	/**
	 * Start edit dialog
	 * @method edit
	 */
	edit: function () {
		var tool = this;

		Q.Dialogs.push({
			title: tool.text.EditQuestion,
			className: "Streams_dialog_editQuestion",
			template: {
				name: "Streams/question/composer",
				fields: {
					hideUntilAnswered: tool.stream.getAttribute("hideUntilAnswered"),
					cantChangeAnswers: tool.stream.getAttribute("cantChangeAnswers")
				}
			},
			onActivate: function (dialog) {
				$(".Streams_question_title", dialog).tool("Streams/inplace", {
					stream: tool.stream,
					field: "title",
					inplaceType: "text",
					inplace: {
						placeholder: tool.text.TitlePlaceholder,
						selectOnEdit: false
					}
				}).activate();
				$(".Streams_question_subtitle", dialog).tool("Streams/inplace", {
					stream: tool.stream,
					field: "content",
					inplaceType: "textarea",
					inplace: {
						placeholder: tool.text.ContentPlaceholder,
						selectOnEdit: false
					}
				}).activate();
				$(".Streams_question_answers", dialog).tool("Streams/related", {
					publisherId: tool.stream.fields.publisherId,
					streamName: tool.stream.fields.name,
					relationType: "Streams/answers",
					realtime: false,
					sortable: true,
					isCategory: true,
					composerPosition: "last",
					relatedOptions: {
						ascending: true,
					},
					creatable: {
						"Streams/answer": {
							publisherId: tool.stream.fields.publisherId,
							title: tool.text.NewPossibleAnswer
						}
					}
				}).activate();
				$("input[name=hideUntilAnswered]", dialog).on("change", function () {
					tool.stream.setAttribute("hideUntilAnswered", $(this).prop("checked"));
					tool.stream.save({
						onSave: function () {
							tool.stream.refresh(function () {
								tool.stream = this;
							}, {
								messages: true,
								evenIfNotRetained: true
							});
						}
					});
				});
				$("input[name=cantChangeAnswers]", dialog).on("change", function () {
					tool.stream.setAttribute("cantChangeAnswers", $(this).prop("checked"));
					tool.stream.save({
						onSave: function () {
							tool.stream.refresh(function () {
								tool.stream = this;
							}, {
								messages: true,
								evenIfNotRetained: true
							});
						}
					});
				});
			},
			onClose: function () {
				$(".Streams_related_tool").each(function () {
					var answersRelated = Q.Tool.from(this, "Streams/related");
					if (!answersRelated) {
						return;
					}

					if (answersRelated.state.publisherId !== tool.preview.state.publisherId || answersRelated.state.streamName !== tool.preview.state.streamName) {
						return;
					}

					answersRelated.refresh();
				});
			}
		});
	},
	Q: {
		beforeRemove: function () {
			var $answersRelated = this.$answersRelated;
			if ($answersRelated && $answersRelated.length) {
				// remove answers related tool
				Q.Tool.remove($answersRelated[0], true, true);
			}
		}
	}
});

Q.Template.set('Streams/question/composer',
	`<div class="Streams_question_title"></div>
	<div class="Streams_question_subtitle"></div>
	<div class="Streams_question_attributes">
		<label><input type="checkbox" name="hideUntilAnswered" {{#if hideUntilAnswered}}checked="checked"{{/if}}> {{questions.HideUntilAnswered}}</label>
		<label><input type="checkbox" name="cantChangeAnswers" {{#if cantChangeAnswers}}checked="checked"{{/if}}> {{questions.CantChangeAnswers}}</label>
	</div>
	<h2 class="Streams_question_head">{{questions.Answers}}</h2>
	<div class="Streams_question_answers"></div>`,
	{text: ['Streams/content']}
);

})(Q, Q.jQuery, window);
