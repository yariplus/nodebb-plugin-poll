"use strict";

var async = require('async'),

	NodeBB = require('./nodebb'),

	Vote = require('./vote'),
	Scheduler = require('./scheduler');

(function(Poll) {

	var POLL_DATA_VERSION = 2;

	Poll.add = function(pollData, postData, callback) {
		NodeBB.db.incrObjectField('global', 'nextPollId', function(err, pollId) {
			if (err) {
				return callback(err);
			}

			var poll = {
				pollId: pollId,
				uid: postData.uid,
				tid: postData.tid,
				pid: postData.pid,
				deleted: 0,
				ended: 0,
				timestamp: postData.timestamp,
				voteCount: 0,
				version: POLL_DATA_VERSION
			};

			pollData.options = pollData.options.map(function(val, i) {
				return {
					id: i,
					title: val,
					voteCount: 0
				};
			});

			// async this bitch up
			async.parallel([
				async.apply(async.each, pollData.options, function(option, next) {
					async.parallel([
						async.apply(NodeBB.db.setObject, 'poll:' + pollId + ':options:' + option.id, option),
						async.apply(NodeBB.db.setAdd, 'poll:' + pollId + ':options', option.id)
					], next);
				}),
				async.apply(NodeBB.db.setObject, 'poll:' + pollId, poll),
				async.apply(NodeBB.db.setObject, 'poll:' + pollId + ':settings', pollData.settings),
				async.apply(NodeBB.db.listAppend, 'polls', pollId),
				async.apply(NodeBB.db.setObjectField, 'topic:' + poll.tid, 'pollId', pollId)
			], function(err) {
				if (err) {
					return callback(err);
				}

				// Check if this poll is scheduled to end
				if (parseInt(pollData.settings.end, 10) > 0) {
					Poll.schedule(pollId);
				}

				return callback(null, pollId);
			});
		});
	};

	Poll.get = function(pollId, uid, withVotes, callback) {
		async.parallel({
			info: function(next) {
				Poll.getInfo(pollId, next);
			},
			options: function(next) {
				Poll.getOptions(pollId, withVotes, next);
			},
			settings: function(next) {
				Poll.getSettings(pollId, next);
			},
			hasVoted: function(next) {
				if (uid) {
					Vote.hasUidVoted(uid, pollId, next);
				} else {
					next(null, false);
				}
			}
		}, function(err, pollData) {
			if (err) {
				return callback(err);
			}

			pollData.options.forEach(function(option) {
				var percentage = ((option.voteCount / pollData.info.voteCount) * 100).toFixed(0);
				option.percentage = isNaN(percentage) ? 0 : percentage;
			});

			callback(null, pollData);
		});
	};

	Poll.getPollIdByTid = function(tid, callback) {
		NodeBB.db.getObjectField('topic:' + tid, 'pollId', callback);
	};

	Poll.getPollIdByPid = function(pid, callback) {
		NodeBB.db.getObjectField('post:' + pid, 'pollId', callback);
	};

	Poll.getInfo = function(pollId, callback) {
		NodeBB.db.getObject('poll:' + pollId, callback);
	};

	Poll.getOptions = function(pollId, withVotes, callback) {
		if (typeof withVotes === 'function') {
			callback = withVotes;
			withVotes = false;
		}

		NodeBB.db.getSetMembers('poll:' + pollId + ':options', function(err, options) {
			async.map(options, function(option, next) {
				Poll.getOption(pollId, option, withVotes, next);
			}, callback);
		});
	};

	Poll.getOption = function(pollId, option, withVotes, callback) {
		async.parallel({
			option: function(next) {
				NodeBB.db.getObject('poll:' + pollId + ':options:' + option, next);
			},
			votes: function(next) {
				if (withVotes) {
					NodeBB.db.getSetMembers('poll:' + pollId + ':options:' + option + ':votes', next);
				} else {
					next();
				}
			}
		}, function(err, results) {
			if (err) {
				return callback(err);
			}

			if (results.votes) {
				results.option.votes = results.votes;
			}
			results.option.voteCount = parseInt(results.option.voteCount, 10) || 0;

			callback(null, results.option);
		});
	};

	Poll.hasOption = function(pollId, option, callback) {
		NodeBB.db.isSetMember('poll:' + pollId + ':options', option, callback);
	};

	Poll.hasOptions = function(pollId, options, callback) {
		NodeBB.db.isSetMembers('poll:' + pollId + ':options', options, callback);
	};

	Poll.getSettings = function(pollId, callback) {
		NodeBB.db.getObject('poll:' + pollId + ':settings', callback);
	};

	Poll.isDeleted = function(pollId, callback) {
		Poll.getField(pollId, 'deleted', function(err, result) {
			callback(err, parseInt(result, 10) === 1);
		});
	};

	Poll.delete = function(pollId) {
		Poll.setField(pollId, 'deleted', 1);
	};

	Poll.restore = function(pollId) {
		Poll.setField(pollId, 'edited', 0);
		Poll.setField(pollId, 'deleted', 0);
	};

	Poll.schedule = function(pollId) {
		NodeBB.db.setAdd('polls:scheduled', pollId);
		Scheduler.add(pollId);
	};

	Poll.getScheduled = function(callback) {
		NodeBB.db.getSetMembers('polls:scheduled', callback);
	};

	Poll.hasEnded = function(pollId, callback) {
		Poll.getField(pollId, 'ended', function(err, result) {
			callback(err, parseInt(result, 10) === 1);
		});
	};

	Poll.end = function(pollId) {
		NodeBB.db.setRemove('polls:scheduled', pollId);
		Poll.setField(pollId, 'ended', 1);
	};

	Poll.changePid = function(pollId, pid, callback) {
		async.parallel([
			function(next) {
				Poll.setField(pollId, 'pid', pid, next);
			},
			function(next) {
				NodeBB.db.setObjectField('post:' + pid, 'pollId', pollId, next);
			}
		], callback);
	};

	Poll.changeTid = function(pollId, tid, callback) {
		async.parallel([
			function(next) {
				Poll.setField(pollId, 'tid', tid, next);
			},
			function(next) {
				NodeBB.db.setObjectField('topic:' + tid, 'pollId', pollId, next);
			}
		], callback);
	};

	Poll.setField = function(pollId, field, value, callback) {
		NodeBB.db.setObjectField('poll:' + pollId, field, value, callback);
	};

	Poll.setFields = function(pollId, fields, values, callback) {
		NodeBB.db.setObjectFields('poll:' + pollId, fields, values, callback);
	};

	Poll.getField = function(pollId, field, callback) {
		NodeBB.db.getObjectField('poll:' + pollId, field, callback);
	};

	Poll.getFields = function(pollId, fields, callback) {
		NodeBB.db.getObjectFields('poll:' + pollId, fields, callback);
	};

})(exports);