module.exports = function (options, callback) {
	var Q = require('Q');
	var f = options.fields;
	f.streamTitleEmojiPrefix = Q.Config.get([
		'Streams', 'types', f.stream.fields.type, 'emoji'
	], null) || '';
	f.fromTitleEmojiPrefix = Q.Config.get([
		'Streams', 'types', f.fromType, 'emoji'
	], null) || '';
	if (f.streamTitleEmojiPrefix) {
		f.streamTitleEmojiPrefix += ' ';
	}
	if (f.fromTitleEmojiPrefix) {
		f.fromTitleEmojiPrefix += ' ';
	}
	// Only fall back to this emoji+content default when no stream type
	// has customized "Streams/relatedTo"'s own subject beyond the
	// platform's own unrendered-template default (Streams/config/
	// plugin.json's generic "messages"/"Streams/relatedTo"/"subject")
	// -- options.subject already holds whichever of the two
	// Streams_Message.prototype.deliver (classes/Streams/Message.js)
	// resolved via Streams.Stream.getConfigField before this handler
	// ever ran; unconditionally overwriting it here stomped every
	// stream-type-specific override (e.g. Media/channel's own "<name>
	// uploaded a new video"), not just the platform's own default.
	if (options.subject === "{{{call 'message.getInstruction' 'description'}}}") {
		// this.fields.content, not this.getInstruction('description'):
		// content is always the already-rendered, human-readable text
		// Streams::relate() (classes/Streams.php) computed for the
		// message body itself (e.g. "New episode in Emily clips");
		// instructions.description is the RAW, still-unrendered config
		// value relate() stored alongside it for other templates to
		// use (sometimes a plain string, sometimes an i18n-array
		// shorthand) -- always truthy, so the old `description ||
		// content` order meant content was dead code and a stored
		// array rendered as "a,b,c" via string concatenation's
		// implicit toString() (confirmed live: a real sent email had
		// exactly that as its subject).
		options.subject = f.fromTitleEmojiPrefix
			+ (this.fields.content || this.getInstruction('description'));
	}
	callback();
}