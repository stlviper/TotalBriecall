'use strict';

var _ = require('underscore'),
	moment = require('moment'),
	path = require('path'),
	Promise = require('bluebird'),
	request = require('request-promise'),
	FoodResult = require(path.join(global.__modelsdir, 'foodresult'));

var options = {
		uri: 'https://api.fda.gov/food/enforcement.json',
		method: 'GET',
		resolveWithFullResponse: true, // useful for debugging
		json: true,
		// need to use node's querystring for overriding the url encoding (fda's api does not handle it), needed to work with complex searches
		useQuerystring: true,
		// override the encode function
		qsStringifyOptions: {
			encodeURIComponent: function identity(str) { // requires node 0.12
				return str;
			}
		}
	},
	limit = 100,
	stateMappings = {
		AL: ['AL', 'Alabama'],
		AK: ['AK', 'Alaska'],
		AZ: ['AZ', 'Arizona'],
		AR: ['AR', 'Arkansas'],
		CA: ['CA', 'California'],
		CO: ['CO', 'Colorado'],
		CT: ['CT', 'Connecticut'],
		DE: ['DE', 'Delaware'],
		FL: ['FL', 'Florida'],
		GA: ['GA', 'Georgia'],
		HI: ['HI', 'Hawaii'],
		ID: ['ID', 'Idaho'],
		IL: ['IL', 'Illinois'],
		IN: ['IN', 'Indiana'],
		IA: ['IA', 'Iowa'],
		KS: ['KS', 'Kansas'],
		KY: ['KY', 'Kentucky'],
		LA: ['LA', 'Louisiana'],
		ME: ['ME', 'Maine'],
		MD: ['MD', 'Maryland'],
		MA: ['MA', 'Massachusetts'],
		MI: ['MI', 'Michigan'],
		MN: ['MN', 'Minnesota'],
		MS: ['MS', 'Mississippi'],
		MO: ['MO', 'Missouri'],
		MT: ['MT', 'Montana'],
		NE: ['NE', 'Nebraska'],
		NV: ['NV', 'Nevada'],
		NH: ['NH', 'New Hampshire'],
		NJ: ['NJ', 'New Jersey'],
		NM: ['NM', 'New Mexico'],
		NY: ['NY', 'New York'],
		NC: ['NC', 'North Carolina'],
		ND: ['ND', 'North Dakota'],
		OH: ['OH', 'Ohio'],
		OK: ['OK', 'Oklahoma'],
		OR: ['OR', 'Oregon'],
		PA: ['PA', 'Pennsylvania'],
		RI: ['RI', 'Rhode Island'],
		SC: ['SC', 'South Carolina'],
		SD: ['SD', 'South Dakota'],
		TN: ['TN', 'Tennessee'],
		TX: ['TX', 'Texas'],
		UT: ['UT', 'Utah'],
		VT: ['VT', 'Vermont'],
		VA: ['VA', 'Virginia'],
		WA: ['WA', 'Washington'],
		WV: ['WV', 'West Virginia'],
		WI: ['WI', 'Wisconsin'],
		WY: ['WY', 'Wyoming'],
		DC: ['DC', 'District of Columbia', 'D.C.']
	},
	stateAbbreviations = _.keys(stateMappings).sort(),
	stateRegexes = _.reduce(stateMappings, function (memo, values, key) {
		memo[key] = _.map(values, function (val) {
			return new RegExp(val, 'i');
		});
		return memo;
	}, {}),
	nationalTerms = [
		'nationwide', // misspellings in database will exclude 'natiowide'
		'national distribution',
		'nation wide',
		'nationally',
		'us',
		'usa'
	],
	nationalRegexes = _.map(nationalTerms, function (val) {
		return new RegExp(val, 'i');
	}),
	keywordMappings = {
		'dairy': ['dairy', 'milk', 'cheese', 'cheeses', 'whey'],
		'dye': ['dye', 'color', 'colors', 'red', 'yellow', 'pink', 'blue', 'green'],
		'egg': ['egg', 'eggs'],
		'fish': ['fish', 'shellfish', 'oyster', 'oysters'],
		'gluten': ['gluten', 'wheat'],
		'nut': ['nut', 'nuts', 'peanut', 'peanuts', 'seed', 'seeds', 'walnut', 'walnuts', 'almond', 'almonds', 'pistachio', 'pistachios', 'hazelnut', 'hazelnuts'],
		'soy': ['soy', 'tofu']
	};

/**
 * Format input for use in search
 * @param {String} val
 * @returns {String}
 * @private
 */
function _formatValue(val) {
	return val.replace(/ /g, '+');
}

/**
 * Converts an array of values to query string using field
 * @param {String[]} arr Values to match against
 * @param {String} field Field to query on
 * @returns {string}
 * @private
 */
function _convertArrayToParam(arr, field) {
	return '(' + _.map(arr, function (ele) {
			return field + ':"' + _formatValue(ele) + '"';
		}).join('+') + ')';
}

/**
 * Makes a request to the openFDA's api
 * @param obj
 * @param {String} obj.search
 * @param {Number} [obj.skip]
 * @param {Number} [obj.limit]
 * @returns {Promise}
 * @private
 */
function _makeRequest(obj) {
	if (obj.limit) {
		if (obj.limit > 100) {
			return Promise.reject(new Error('Invalid limit'));
		}
	} else {
		obj.limit = limit;
	}

	if (obj.skip && obj.skip > 5000) {
		return Promise.reject(new Error('Invalid skip'));
	}

	console.log('Making request to api', obj);
	return request.get(_.extend(options, {
		qs: obj
	})).then(function (response) {
		//console.log(response);
		var data = response.body;

		data.results = _.map(data.results, function (foodrecall) {
			foodrecall.recall_initiation_date = moment(foodrecall.recall_initiation_date, 'YYYY-MM-DD').unix();
			foodrecall.report_date = moment(foodrecall.report_date, 'YYYY-MM-DD').unix();

			foodrecall.classificationlevel = foodrecall.classification.match(/I/g).length;

			// TODO Sometimes field is null, could parse reason for recall for some
			foodrecall.mandated = foodrecall.voluntary_mandated ? foodrecall.voluntary_mandated.match(/mandated/i) !== null : false;

			// If we match a national term, select all states
			if (_.some(nationalRegexes, function (regex) {
					return foodrecall.distribution_pattern.match(regex) !== null;
				})) {
				foodrecall.affectedstates = stateAbbreviations;
				foodrecall.affectednationally = true;
			} else {
				// Otherwise, find the states that match
				foodrecall.affectedstates = _.keys(_.pick(stateRegexes, function (regexs) {
					return _.some(regexs, function (regex) {
						return foodrecall.distribution_pattern.match(regex) !== null;
					});
				})).sort();
				foodrecall.affectednationally = false;
			}

			return _.omit(foodrecall, ['@id', '@epoch', 'openfda']);
		});

		return new FoodResult(data);
	}).catch(function (err) {
		//console.log(err);
		// TODO need better wrapper for error handling
		console.log(err.statusCode + ' - ' + JSON.stringify(err.error));
		throw {
			statusCode: err.statusCode,
			error: err.error.error // `error` for request -> `error` for openFDA response
		};
	});
}

/**
 * Validates state
 * @param {String} state
 * @returns {boolean}
 */
exports.isValidState = function (state) {
	return stateMappings.hasOwnProperty(state.toUpperCase());
};

/**
 * Validates keywords
 * @param {String[]} keywords
 * @returns {String|undefined} Returns first invalid element or undefined if all are valid
 */
exports.areValidKeywords = function (keywords) {
	return _.find(keywords, function (keyword) {
		return !keywordMappings.hasOwnProperty(keyword.toLowerCase());
	});
};

/**
 * Gets food recall details for specific recall id
 * @param obj
 * @param {Number} obj.id
 * @returns {Promise}
 */
exports.getFoodRecallById = function (obj) {
	return _makeRequest({
		search: 'recall_number:"' + obj.id + '"',
		limit: 1
	});
};

/**
 * Gets food recall(s) details for event
 * @param obj
 * @param {Number} obj.id
 * @param {Number} [obj.skip]
 * @param {Number} [obj.limit]
 * @returns {Promise}
 */
exports.getFoodRecallByEventId = function (obj) {
	return _makeRequest({
		search: 'event_id:' + obj.id,
		skip: obj.skip || null,
		limit: obj.limit || null
	});
};

/**
 * Gets food recall(s) for recalling firm
 * @param obj
 * @param {String} obj.name
 * @param {Number} [obj.skip]
 * @param {Number} [obj.limit]
 * @returns {Promise}
 */
exports.getFoodRecallByRecallingFirm = function (obj) {
	return _makeRequest({
		search: 'recalling_firm:"' + _formatValue(obj.name) + '"',
		skip: obj.skip || null,
		limit: obj.limit || null
	});
};

/**
 * Gets food recall(s) based on search parameters
 * @param obj
 * @param {String[]} [obj.locations]
 * @param {Number} [obj.from]
 * @param {Number} [obj.to]
 * @param {Number} [obj.classificationlevel]
 * @param {String[]} [obj.keywords]
 * @param {Number} [obj.skip]
 * @param {Number} [obj.limit]
 * @returns {Promise}
 */
exports.getFoodRecallBySearch = function (obj) {
	var search = [];

	if (obj.state) {
		search.push(_convertArrayToParam(stateMappings[obj.state.toUpperCase()].concat(nationalTerms), 'distribution_pattern'));
	}

	if (obj.from && obj.to) {
		search.push('recall_initiation_date:[' + moment.unix(obj.from).utc().format('YYYY-MM-DD') + '+TO+' + moment.unix(obj.to).utc().format('YYYY-MM-DD') + ']');
	}

	if (obj.classificationlevel) {
		search.push('classification:"Class+' + (new Array(obj.classificationlevel + 1).join('I')) + '"');
	}

	if (obj.keywords) {
		search.push(_convertArrayToParam(_.reduce(obj.keywords, function (arr, keyword) {
			return arr.concat(keywordMappings[keyword.toLowerCase()]);
		}, []), 'reason_for_recall'));
	}

	return _makeRequest({
		search: search.join('+AND+'),
		skip: obj.skip || null,
		limit: obj.limit || null
	});
};