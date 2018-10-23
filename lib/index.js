var log4js = require('log4js');
var lxHelpers = require('lx-helpers');
var mongodb = require('mongodb');

/**
 * Returns a function to log data in mongodb.
 *
 * @param {Object} config The configuration object.
 * @param {string} config.connectionString The connection string to the mongo db.
 * @param {string=} config.layout The log4js layout.
 * @param {string=} config.write The write mode.
 * @returns {Function}
 */
function mongodbAppender(config, layout) {
    if (!config || !config.connectionString) {
        throw new Error('connectionString is missing. Cannot connect to mongdb.');
    }

    var collection;
    var cache = [];
    var collectionName = config.collectionName || 'log';
    var connectionOptions = config.connectionOptions || {};
    connectionOptions.useNewUrlParser = true

    function ERROR(err) {
        Error.call(this);
        Error.captureStackTrace(this, this.constructor);

        this.name = err.toString();
        this.message = err.message || 'error';
    }

    function replaceKeys(src) {
        var result = {};

        function mixin(dest, source, cloneFunc) {
            if (lxHelpers.isObject(source)) {
                lxHelpers.forEach(source, function (value, key) {
                    // replace $ at start
                    if (key[0] === '$') {
                        key = key.replace('$', '_dollar_');
                    }

                    // replace all dots
                    key = key.replace(/\./g, '_dot_');

                    dest[key] = cloneFunc ? cloneFunc(value) : value;
                });
            }

            return dest;
        }

        if (!src || typeof src !== 'object' || typeof src === 'function' || src instanceof Date || src instanceof RegExp ||  src instanceof mongodb.ObjectID) {
            return src;
        }

        // wrap Errors in a new object because otherwise they are saved as an empty object {}
        if (lxHelpers.getType(src) === 'error') {
            return new ERROR(src);
        }

        // Array
        if (lxHelpers.isArray(src)) {
            result = [];

            lxHelpers.arrayForEach(src, function (item) {
                result.push(replaceKeys(item));
            });
        }

        return mixin(result, src, replaceKeys);
    }

    function getOptions() {
        var options = { w: 0 };

        if (config.write === 'normal') {
            options.w = 1;
        }

        if (config.write === 'safe') {
            options.w = 1;
            options.journal = true;
        }

        return options;
    }

    function insert(loggingEvent) {
        var options = getOptions();

        if (collection) {
            if (options.w === 0) {
                // fast write
                collection.insert({
                    timestamp: loggingEvent.startTime,
                    data: loggingEvent.data,
                    level: loggingEvent.level,
                    category: loggingEvent.categoryName
                }, options);
            } else {
                // save write
                collection.insert({
                    timestamp: loggingEvent.startTime,
                    data: loggingEvent.data,
                    level: loggingEvent.level,
                    category: loggingEvent.categoryName
                }, options, function (error) {
                    if (error) {
                        console.error('log: Error writing data to log!');
                        console.error(error);
                        console.log('log: Connection: %s, collection: %, data: %j', config.connectionString, collectionName, loggingEvent);
                    }
                });
            }
        } else {
            cache.push(loggingEvent);
        }
    }

    // check connection string
    if (config.connectionString.indexOf('mongodb://') !== 0) {
        config.connectionString = 'mongodb://' + config.connectionString;
    }

    // connect to mongodb
    mongodb.MongoClient.connect(config.connectionString, connectionOptions, function (err, client) {
        if (err) {
            console.error('Error connecting to mongodb! URL: %s', config.connectionString);
            console.error(err);
        }

        collection = client.db().collection(config.collectionName || 'log');

        // process cache
        cache.forEach(function (loggingEvent) {
            setImmediate(function () {
                insert(loggingEvent);
            });
        });
    });

    return function (loggingEvent) {
        // get the information to log
        if (Object.prototype.toString.call(loggingEvent.data[0]) === '[object String]') {
            // format string with layout
            loggingEvent.data = layout(loggingEvent);
        } else if (loggingEvent.data.length === 1) {
            loggingEvent.data = loggingEvent.data[0];
        }

        loggingEvent.data = replaceKeys(loggingEvent.data);

        // save in db
        insert(loggingEvent);
    };
}

function configure(config, layouts, findAppender, levels) {
    let layout = layouts.messagePassThroughLayout;
    if (config.layout) {
      layout = layouts.layout(config.layout.type, config.layout);
    }
    return mongodbAppender(config, layout);
}

exports.appender = mongodbAppender;
exports.configure = configure;
