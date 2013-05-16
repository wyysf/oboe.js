
var oboe = (function(oboe){
   "use strict";

   /**
    * @param {Object} opt an object of options. Passed though
    * directly to clarinet.js but oboe.js does not
    * currently provide options.
    */
   oboe.parser = function(opt){
      return new OboeParser(opt);
   };
   
   /**
    * Convenient alias. Creates a new parser, starts an ajax request and returns the parser
    * ready to call .onPath() or .onFind() to register some callbacks
    * @param url
    */
   oboe.fetch = function(url){
      return new OboeParser().fetch(url);
   };      
      
   function OboeParser(opt) {
   
      var clarinetParser = clarinet.parser(opt);
   
      this._thingFoundListeners = [];
      this._pathMatchedListeners = [];
      this._errorListeners = [];
      this._clarinet = clarinetParser;
         
      this._listenForSaxEvents(clarinetParser)        
   }
   
   OboeParser.prototype._listenForSaxEvents = function( clarinet ) {
   
      var   oboeInstance = this
      ,     curNode
      ,     curKey
      ,     nodeStack = [] // TODO: use fastlist
      ,     pathStack = [];

   
      clarinet.onkey = function (nextKey) {
         oboeInstance._notifyListeners(oboeInstance._pathMatchedListeners, null, pathStack.concat(nextKey), nodeStack);
   
         curKey = nextKey;
      };
      
      
      function entityFound( thingFound, foundIn ) {

         var foundInArray = isArray(foundIn),
             thingFoundIsPrimative = (typeof thingFound) !== 'object';
         
         if( foundInArray ) {
            console.log('found something in an arary, at path', pathStack.concat(curKey));
            oboeInstance._notifyListeners(oboeInstance._pathMatchedListeners, curNode, pathStack.concat(curKey), nodeStack);            
         }
         
         foundIn[curKey] = thingFound;

         // if the thing we have found is a primitive, we can notify of it being found now. Otherwise, 
         // if it is an array or object we will call this on its close.            
         if( thingFoundIsPrimative ) {
            oboeInstance._notifyListeners(oboeInstance._thingFoundListeners, thingFound, pathStack.concat(curKey), nodeStack);         
         }
      }
          
      /**
       * implementation of onopenobject and onopenarray 
       * */                    
      function onOpen( newObject, firstKey, hasKnownContents ) {

         var openedObjectIsRoot = !curNode,      
             parentNode = curNode;
                  
         curNode = newObject;
   
         if( openedObjectIsRoot ) {
         
            // Parsed the root object. Notify path listeners (eg to '!' or '*') that the root object has been found:
            oboeInstance._notifyListeners(oboeInstance._pathMatchedListeners, curNode, pathStack, nodeStack);
            
         } else {
         
            // found some object other than the root object. no new path to notify of for this object because
            // should have already been notified.
            //parentNode[curKey] = curNode;
            
            entityFound(newObject, parentNode);
                        
            pathStack.push(curKey);                          
         }
   
         nodeStack.push(curNode); 

         // We know the first key of the newly parsed object. Notify that path has been found but don't put firstKey
         // perminantly onto pathStack yet because we haven't identified what is at that key yet. We also give null
         // as the curNode because we've only so far seen the key, not the node.
         // If the entity just opened is an empty object or an array, there are no known contents so this will not be
         // notified here. For non-empty arrays the paths will have to be notified in the following calls to 
         // onvalue or onopenfoo. 
         if( hasKnownContents ) {         
            oboeInstance._notifyListeners(oboeInstance._pathMatchedListeners, null, pathStack.concat(firstKey), nodeStack);
         }         
   
         // clarinet always gives the first key of the new object.
         curKey = firstKey;            
      }                    
                                     
      clarinet.onopenobject = function (firstKey) {

         onOpen({}, firstKey, firstKey !== undefined);
      };
      
      clarinet.onopenarray = function () {
                  
         onOpen([], 0, false);
      };
      
      function entityFinished( foundIn ) {
         if( isArray(foundIn) ) {
            curKey = curNode.length;
         } else {
            // we're in an object, curKey has been used now and we don't know what the next key will 
            // be so mark as null:
            curKey = null;
         }      
      }      
      
      clarinet.onvalue = function (value) {
      
         entityFound(value, curNode);
         
         entityFinished(curNode);
      };         
      
      clarinet.onend =
      clarinet.oncloseobject =
      clarinet.onclosearray = function () {

         // pop the curNode off the nodestack because curNode is the thing we just
         // identified and it shouldn't be listed as an ancestor of itself:
         nodeStack.pop();
   
         oboeInstance._notifyListeners(oboeInstance._thingFoundListeners, curNode, pathStack, nodeStack);
   
         pathStack.pop();
         curNode = lastOf(nodeStack);
   
         entityFinished(curNode);   
      };
         
      clarinet.onerror = function(e) {
         oboeInstance._notifyErrors(e);
         
         // after parse errors the json is invalid so, we won't bother trying to recover, so just give up
         oboeInstance.close();
      };       
   }; 
      
   OboeParser.prototype.fetch = function(url) {

      // TODO: in if in node, use require('http') instead of ajax

      streamingXhr.fetch(
         url, 
         this.read.bind(this),
         this.close.bind(this) );

      return this;
   };

   
   /**
    * notify any of the listeners that are interested in the path.       
    */  
   OboeParser.prototype._notifyListeners = function ( listenerList, curNode, path, ancestors ) {
      
      var nodeList = ancestors.concat([curNode]);

      listenerList
         .forEach( function(listener) {
            
            var foundNode = listener.test( path, nodeList );
            
            // possible values for foundNode now:
            //
            //    false: 
            //       we did not match
            //    an object/array/string/number: 
            //       that node is the one that matched
            //    null: like above, but we don't have the node yet. ie, we know there is a
            //          node that matches but we don't know if it is an array, object, string
            //          etc yet so we can't say anything about it 
                        
            if( foundNode !== false ) {                     
               var context = listener.context || window;
               
               // change curNode to foundNode when it stops breaking tests
               try{
                  listener.callback.call(context, foundNode, path, ancestors );
               } catch(e) {
                  this._notifyErrors(Error('Error thrown by callback ' + e.message));
               }
            }                            
         }, this);
   };
   
   OboeParser.prototype._notifyErrors = function(error) {
      this._errorListeners.forEach( function( listener ) {
         listener(error);
      });   
   };   

   /**
    * called when there is new text to parse
    * 
    * @param {String} nextDrip
    */
   OboeParser.prototype.read = function (nextDrip) {
      if( this.closed ) {
         throw Error('closed');
      }
   
      try {
         this._clarinet.write(nextDrip);
      } catch(e) {
         // we don't have to do anything here because we always assign a .onerror
         // to clarinet which will have already been called by the time this 
         // exception is thrown.                
      }
   };
            
   /**
    * called when the input is done
    * 
    */
   OboeParser.prototype.close = function () {
      this.closed = true;
      
      // we won't fire any more events again so forget our listeners:
      this._thingFoundListeners = [];
      this._pathMatchedListeners = [];
      this._errorListeners = [];
      
      var clarinet = this._clarinet;
      
      // quit listening to clarinet as well. We've done with this stream:
      clarinet.onkey = 
      clarinet.onvalue = 
      clarinet.onopenobject = 
      clarinet.onopenarray = 
      clarinet.onend = 
      clarinet.oncloseobject =                         
      clarinet.onclosearray = 
      clarinet.onerror = null;
      
      clarinet.close();            
   };
   
   /**
    * @returns {*} an identifier that can later be used to de-register this listener
    */
   function pushListener(listenerList, pattern, callback, context) {
      return listenerList.push({
         pattern:pattern,
         test: jsonPathCompiler(pattern),
         callback: callback,
         context: context
      });
   }

   /**
    * 
    * @param listenerMap
    */
   function pushListeners(listenerList, listenerMap) {
      for( var path in listenerMap ) {
         pushListener(listenerList, path, listenerMap[path]);
      }
   }
   
   function on(listenerList, jsonPath, callback, context) {
      if( typeof jsonPath === 'string' ) {
         pushListener(listenerList, jsonPath, callback, context);
      } else {
         pushListeners(listenerList, jsonPath);
      }      
   }
   
   /**
    * Add a new json path to the parser, to be called as soon as the path is found, but before we know
    * what value will be in there.
    *
    * @param {String} jsonPath
    *    The jsonPath is a variant of JSONPath patterns and supports these special meanings.
    *    See http://goessner.net/articles/JsonPath/
    *          !                - root json object
    *          .                - path separator
    *          foo              - path node 'foo'
    *          ['foo']          - paFth node 'foo'
    *          [1]              - path node '1' (only for numbers indexes, usually arrays)
    *          *                - wildcard - all objects/properties
    *          ..               - any number of intermediate nodes (non-greedy)
    *          [*]              - equivalent to .*         
    *
    * @param {Function} callback({Object}foundNode, {String[]}path, {Object[]}ancestors)
    * 
    * @param {Object} [context] the context ('this') for the callback
    */
   OboeParser.prototype.onPath = function (jsonPath, callback, context) {
   
      on(this._pathMatchedListeners, jsonPath, callback, context);
      return this;
   };

   /**
    * Add a new json path to the parser, which will be called when a value is found at the given path
    *
    * @param {String} jsonPath supports the same syntax as .onPath.
    *
    * @param {Function} callback({Object}foundNode, {String[]}path, {Object[]}ancestors)
    * @param {Object} [context] the context ('this') for the callback
    */
   OboeParser.prototype.onFind = function (jsonPath, callback, context) {
   
      on(this._thingFoundListeners, jsonPath, callback, context);
      return this;
   };
   
   /**
    * Add a new json path to the parser, which will be called when a value is found at the given path
    *
    * @param {Function} callback
    */
   OboeParser.prototype.onError = function (callback) {

      this._errorListeners.push(callback);
      return this;
   };
   
   return oboe;

})( typeof exports === "undefined" ? {} : exports );