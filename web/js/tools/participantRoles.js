(function (Q, $) {

/**
 * Select participant roles to offer when inviting someone to a stream.
 *
 * Separate from the community-role picker on purpose: different vocabulary
 * (config-declared per stream type, not users_label), different storage
 * (streams_participant extra.role), different presentation (emoji, not icon).
 * Shares only the chip styling.
 *
 * @class Streams participantRoles
 * @constructor
 * @param {Object} [options]
 * @param {String} options.publisherId
 * @param {String} options.streamName
 * @param {Array} [options.available] [{role, title, emoji}] the viewer may grant
 * @param {Array} [options.selected] role names selected to begin with
 * @param {Boolean} [options.readOnly=false]
 * @param {Q.Event} [options.onChange] receives the array of selected role names
 */
Q.Tool.define("Streams/participantRoles", function (options) {
	var tool = this;
	tool.refresh();
},

{
	publisherId: null,
	streamName: null,
	available: [],
	selected: [],
	readOnly: false,
	hideIfEmpty: true,
	displayType: '',
	onChange: new Q.Event(),
	onEmpty: new Q.Event(),
	onRefresh: new Q.Event()
},

{
	refresh: function () {
		var tool = this;
		var state = tool.state;
		var $te = $(tool.element);

		if (!state.available || !state.available.length) {
			// Nothing to offer: either the stream type declares no vocabulary,
			// or this person may grant none of it. hideIfEmpty (the default)
			// removes the tool entirely rather than leaving an empty box or a
			// button that opens nothing.
			if (state.hideIfEmpty) {
				$te.empty().hide();
			} else {
				$te.show().html($('<div class="Streams_participantRoles_none" />')
					.text(Q.getObject('participant.noneAvailable', tool.text)
						|| 'No roles available here.'));
			}
			Q.handle(state.onEmpty, tool, []);
			Q.handle(state.onRefresh, tool, [[]]);
			return;
		}
		$te.show();

		// chips go directly into the tool element -- .Streams_participantRoles_tool
		// is the flex container, same as Communities/roles does with its labels.
		// An extra wrapper div here would sit between the flex parent and its
		// items and collapse the layout.
		var $list = $te;
		$te.empty().toggleClass('Streams_participantRoles_readOnly', !!state.readOnly);
		Q.each(state.available, function (i, item) {
			var selected = state.selected.indexOf(item.role) >= 0;
			var $chip = $('<div class="Streams_participantRoles_chip" />')
				.attr('data-role', item.role)
				.attr('tabindex', state.readOnly ? -1 : 0)
				.attr('role', 'checkbox')
				.attr('aria-checked', selected ? 'true' : 'false')
				.toggleClass('Streams_participantRoles_selected', selected)
				.append($('<span class="Streams_participantRoles_emoji" />').text(item.emoji || ''))
				.append($('<span class="Streams_participantRoles_title" />').text(item.title));
			if (!state.readOnly) {
				$chip.on(Q.Pointer.fastclick, function () {
					tool.toggle(item.role);
					return false;
				});
			}
			$list.append($chip);
		});
		Q.handle(state.onRefresh, tool, [state.available]);
	},

	/**
	 * @method toggle
	 * @param {String} role
	 */
	toggle: function (role) {
		var tool = this;
		var state = tool.state;
		var i = state.selected.indexOf(role);
		if (i >= 0) {
			state.selected.splice(i, 1);
		} else {
			state.selected.push(role);
		}
		$(tool.element)
			.find('[data-role="' + role + '"]')
			.toggleClass('Streams_participantRoles_selected', i < 0)
			.attr('aria-checked', i < 0 ? 'true' : 'false');
		Q.handle(state.onChange, tool, [state.selected.slice()]);
	},

	/**
	 * The roles currently selected, for writing into an invite's
	 * extra.addParticipantRole
	 * @method getSelected
	 * @return {Array}
	 */
	getSelected: function () {
		return this.state.selected.slice();
	}
});

})(Q, Q.jQuery);
