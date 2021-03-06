"use strict";
/* globals $, app, templates, translator, bootbox, define */

(function(Poll) {

	var Creator = {};

	function init() {
		$(window).on('action:composer.enhanced', function() {
			initComposer();
		});
	}

	function initComposer() {
		require(['composer', 'composer/formatting', 'composer/controls'], function(composer, formatting, controls) {
			if (formatting && controls) {
				formatting.addButtonDispatch('poll', function(textarea) {
					composerBtnHandle(composer, textarea);
				});
			}
		});
	}

	function composerBtnHandle(composer, textarea) {
		var post = composer.posts[composer.active];
		if (!post || !post.isMain || !post.cid || isNaN(parseInt(post.cid, 10))) {
			return app.alertError('Can only add poll in main post.');
		}

		Poll.sockets.canCreate({cid: post.cid}, function(err, canCreate) {
			if (err || !canCreate) {
				return app.alertError(err.message);
			}

			Poll.sockets.getConfig(null, function(err, config) {
				var poll = {};

				// If there's already a poll in the post, serialize it for editing
				if (Poll.serializer.canSerialize(textarea.value)) {
					poll = Poll.serializer.serialize(textarea.value, config);

					if (poll.settings.end === 0) {
						delete poll.settings.end;
					} else {
						poll.settings.end = parseInt(poll.settings.end, 10);
					}
				}

				Creator.show(poll, config, function(data) {
					// Anything invalid will be discarded by the serializer
					var markup = Poll.serializer.deserialize(data, config);

					// Remove any existing poll markup
					textarea.value = Poll.serializer.removeMarkup(textarea.value);

					// Insert the poll markup at the bottom
					if (textarea.value.charAt(textarea.value.length - 1) !== '\n') {
						markup = '\n' + markup;
					}

					textarea.value += markup;
				});
			});
		});
	}

	Creator.show = function(poll, config, callback) {
		if (poll.hasOwnProperty('info')) {
			return app.alertError('Editing not implemented.');
		}

		app.parseAndTranslate('poll/creator', { poll: poll, config: config }, function(html) {
			// Initialise modal
			var modal = bootbox.dialog({
				title: '[[poll:creator_title]]',
				message: html,
				className: 'poll-creator',
				buttons: {
					cancel: {
						label: '[[modules:bootbox.cancel]]',
						className: 'btn-default',
						callback: function() {
							return true
						}
					},
					save: {
						label: '[[modules:bootbox.confirm]]',
						className: 'btn-primary',
						callback: function(e) {
							clearErrors();

							var form = $(e.currentTarget).parents('.bootbox').find('#pollCreator');
							var obj = form.serializeObject();

							// Let's be nice and at least show an error if there are no options
							obj.options.filter(function(obj) {
								return obj.length;
							});

							if (obj.options.length == 0) {
								return error('[[poll:error.no_options]]');
							}

							if (obj.settings.end && !moment(obj.settings.end).isValid()) {
								return error('[[poll:error.valid_date]]');
							} else if (obj.settings.end) {
								obj.settings.end = moment(obj.settings.end).valueOf();
							}

							callback(obj);

							return true;
						}
					}
				}
			});

			// Add option adder
			modal.find('#pollAddOption')
				.off('click')
				.on('click', function(e) {
					var el = $(e.currentTarget);
					var prevOption = el.prev();

					if (config.limits.maxOptions <= el.prevAll('input').length) {
						clearErrors();
						translator.translate('[[poll:error.max_options]]', function(text) {
							error(text.replace('%d', config.limits.maxOptions));
						});
						return false;
					}

					if (prevOption.val().length != 0) {
						prevOption.clone().val('').insertBefore(el).focus();
					}
				});

			var datetimepicker = modal.find('#pollInputEnd')
				.datetimepicker({
					sideBySide: true,
					showClear: true,
					useCurrent: true,
					ignoreReadonly: true,
					allowInputToggle: true,
					toolbarPlacement: 'top',
					minDate: moment().add(5, 'minutes'),
					icons: {
						time: "fa fa-clock-o",
						date: "fa fa-calendar",
						up: "fa fa-chevron-up",
						down: "fa fa-chevron-down",
						previous: 'fa fa-chevron-left',
						next: 'fa fa-chevron-right',
						today: 'fa fa-calendar',
						clear: 'fa fa-trash-o',
						close: 'fa fa-times'
					}
				}).data('DateTimePicker');

			if (poll.settings && poll.settings.end) {
				datetimepicker.date(moment(poll.settings.end));
			} else {
				datetimepicker.clear();
			}
		});
	};

	function error(message) {
		var errorBox = $('#pollErrorBox');

		errorBox.removeClass('hidden');
		errorBox.append(message + '<br>');

		return false;
	}

	function clearErrors() {
		$('#pollErrorBox').addClass('hidden').html('');
	}

	function dumbifyObject(obj) {
		var result = {};

		for (var key in obj) {
			if (obj.hasOwnProperty(key)) {
				var val = obj[key];

				if (jQuery.isPlainObject(val)) {
					var obj1 = dumbifyObject(val);
					for (var k1 in obj1) {
						if (obj1.hasOwnProperty(k1)) {
							result[key + '.' + k1] = obj1[k1];
						}
					}
				} else {
					result[key] = val;
				}
			}
		}

		return result;
	}

	Poll.creator = Creator;

	init();

})(window.Poll);
